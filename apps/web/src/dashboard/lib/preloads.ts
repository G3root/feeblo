import { and, createLiveQueryCollection, eq } from "@tanstack/react-db";

import { dashboardCollections } from "./collections";

/**
 * A page's data requirement, named once.
 *
 * Route `beforeLoad`s used to list collection names inline: the same three
 * changelog collections in four files, the same five roadmap collections in
 * two, and a twelve-line list on the post route. "Which collections does this
 * page need" therefore lived in the route rather than beside the collections,
 * and adding a collection meant finding every page that rendered it.
 *
 * Each function here is one page class. Settings pages keep their single
 * `preload()` call inline: one collection is one fact, not a list to keep in
 * sync. The public board's `lib/preloads.ts` is the same shape.
 */

/** The shell every dashboard route renders: sidebar boards, plan gate, workspace. */
export async function preloadDashboardShell(): Promise<void> {
  await Promise.all([
    dashboardCollections.organizationCollection.preload(),
    dashboardCollections.boardCollection.preload(),
    dashboardCollections.workspacePlanCollection.preload(),
  ]);
}

/** The workspace home: its boards, statuses, posts, and their vote counts. */
export async function preloadDashboardHome(): Promise<void> {
  await Promise.all([
    dashboardCollections.boardCollection.preload(),
    dashboardCollections.postCollection.preload(),
    dashboardCollections.postStatusCollection.preload(),
    dashboardCollections.upvoteCollection.preload(),
  ]);
}

/**
 * The board surface's filter, lane, and card data.
 *
 * Also the list half of the post detail page: every collection a detail route
 * renders alongside the slug-scoped subsets is here, so the two lists cannot
 * drift. Board and feedback routes warm this before mount.
 *
 * TanStack DB is deliberately overfetched here: full org collections sync
 * once, then every filter/search/sort runs as an incremental live query
 * (D2 differential dataflow) with no further network trips. Keep it that
 * way — do not "optimize" this into paginated server queries without
 * replacing the whole board data model.
 */
export async function preloadBoardPosts(): Promise<void> {
  await Promise.all([
    dashboardCollections.boardCollection.preload(),
    dashboardCollections.deleteEligibilityCollection.preload(),
    dashboardCollections.postCollection.preload(),
    dashboardCollections.postStatusCollection.preload(),
    dashboardCollections.tagCollection.preload(),
    dashboardCollections.postTagCollection.preload(),
    dashboardCollections.upvoteCollection.preload(),
  ]);
}

/** Roadmap index and detail: the board rows a lane renders. */
export async function preloadRoadmap(): Promise<void> {
  await Promise.all([
    dashboardCollections.boardCollection.preload(),
    dashboardCollections.postCollection.preload(),
    dashboardCollections.postStatusCollection.preload(),
    dashboardCollections.roadmapCollection.preload(),
    dashboardCollections.roadmapColumnCollection.preload(),
  ]);
}

/** Changelog index, published, and draft: the entries and their categories. */
export async function preloadChangelog(): Promise<void> {
  await Promise.all([
    dashboardCollections.changelogCollection.preload(),
    dashboardCollections.changelogCategoryCollection.preload(),
    dashboardCollections.changelogCategoryLinkCollection.preload(),
  ]);
}

/** The changelog editor: the draft plus the posts it can be linked to. */
export async function preloadChangelogEditor(): Promise<void> {
  await Promise.all([
    dashboardCollections.changelogCollection.preload(),
    dashboardCollections.changelogPostCollection.preload(),
    dashboardCollections.postCollection.preload(),
    dashboardCollections.postStatusCollection.preload(),
    dashboardCollections.changelogCategoryCollection.preload(),
    dashboardCollections.changelogCategoryLinkCollection.preload(),
  ]);
}

/** Contacts and companies share this: the CRM lists render both sides. */
export async function preloadContacts(): Promise<void> {
  await Promise.all([
    dashboardCollections.contactCollection.preload(),
    dashboardCollections.contactAttributeDefinitionCollection.preload(),
    dashboardCollections.contactAttributeValueCollection.preload(),
    dashboardCollections.companyCollection.preload(),
  ]);
}

/** The companies list, including the attribute columns it renders. */
export async function preloadCompanies(): Promise<void> {
  await Promise.all([
    dashboardCollections.companyCollection.preload(),
    dashboardCollections.companyAttributeDefinitionCollection.preload(),
    dashboardCollections.companyAttributeValueCollection.preload(),
  ]);
}

/**
 * Post detail: the list rows it shares with the board, plus the slug-scoped
 * subsets its components subscribe to.
 *
 * The slug-scoped collections are `syncMode: "on-demand"`, so calling
 * `preload()` on them is a no-op — their subset is fetched when a live query
 * subscribes, and that subscription normally lives in the route component,
 * which only mounts after the pending shell clears. Building the same subsets
 * here, with the same filters the components use, pulls them in alongside the
 * board rows before the pending shell clears.
 */
export async function preloadPostDetail({
  organizationId,
  postSlug,
}: {
  readonly organizationId: string;
  readonly postSlug: string;
}): Promise<void> {
  const subsets = postDetailSubsets(organizationId, postSlug);

  await Promise.all([
    preloadBoardPosts(),
    subsets.postDetail.preload(),
    subsets.comments.preload(),
    subsets.commentReactions.preload(),
    subsets.postReactions.preload(),
    subsets.postSubscription.preload(),
  ]);
}

/**
 * The live queries a post detail page subscribes to, built once so the
 * preload and the components cannot disagree about their filters.
 */
function postDetailSubsets(organizationId: string, postSlug: string) {
  return {
    // Full-post body for the detail view. The org-scoped list collection
    // carries slim rows (no `content`); this slug-scoped query resolves the
    // body through `GetPost`.
    postDetail: createLiveQueryCollection((query) =>
      query
        .from({ post: dashboardCollections.postDetailCollection })
        .where(({ post }) =>
          and(eq(post.organizationId, organizationId), eq(post.slug, postSlug))
        )
    ),
    commentReactions: createLiveQueryCollection((query) =>
      query
        .from({
          commentReaction: dashboardCollections.commentReactionCollection,
        })
        .where(({ commentReaction }) =>
          and(
            eq(commentReaction.organizationId, organizationId),
            eq(commentReaction.postSlug, postSlug)
          )
        )
    ),
    comments: createLiveQueryCollection((query) =>
      query
        .from({ comment: dashboardCollections.commentCollection })
        .where(({ comment }) =>
          and(
            eq(comment.organizationId, organizationId),
            eq(comment.postSlug, postSlug)
          )
        )
    ),
    postReactions: createLiveQueryCollection((query) =>
      query
        .from({ postReaction: dashboardCollections.postReactionCollection })
        .where(({ postReaction }) =>
          and(
            eq(postReaction.organizationId, organizationId),
            eq(postReaction.postSlug, postSlug)
          )
        )
    ),
    // PostSubscription has no `postSlug` column; its query key falls back to
    // the current URL slug, which is what the SubscribeToggle component relies
    // on too. An org-scoped load is enough to resolve that same slug key.
    postSubscription: createLiveQueryCollection((query) =>
      query
        .from({ subscription: dashboardCollections.postSubscriptionCollection })
        .where(({ subscription }) =>
          eq(subscription.organizationId, organizationId)
        )
    ),
  };
}
