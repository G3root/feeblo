import { and, eq } from "@tanstack/react-db";
import type { DbClient } from "@tanstack/react-db";
import { createIsomorphicFn } from "@tanstack/react-start";

import { markBoardPreloadDegraded } from "./board-scope";
import {
  publicBoardDescriptor,
  publicChangelogCategoryDescriptor,
  publicChangelogCategoryLinkDescriptor,
  publicChangelogDescriptor,
  publicChangelogDetailDescriptor,
  publicCommentDescriptor,
  publicCommentReactionDescriptor,
  publicDeleteEligibilityDescriptor,
  publicPostDescriptor,
  publicPostDetailDescriptor,
  publicPostReactionDescriptor,
  publicPostStatusDescriptor,
  publicPostSubscriptionDescriptor,
  publicPostTagDescriptor,
  publicPostUpvoteDescriptor,
  publicRoadmapColumnDescriptor,
  publicRoadmapDescriptor,
  publicTagDescriptor,
  publicUpvoteDescriptor,
} from "./collections";

/**
 * Server renders await these; if the API is slow, the document is served with
 * whatever arrived and the client finishes the load. Long enough for a normal
 * RPC round trip under load, short enough that a backend incident cannot hold
 * the request open.
 */
const SSR_PRELOAD_BUDGET_MS = 2500;

const isServerRender = createIsomorphicFn()
  .client(() => false)
  .server(() => true);

export interface PreloadOutcome {
  /**
   * True when the server render did not get everything it asked for — the
   * page's content is incomplete, so the document must not be indexed.
   */
  readonly degraded: boolean;
}

/**
 * Awaits a route's preloads.
 *
 * On the client this is a plain `Promise.all`: a failed preload rejects the
 * navigation into the route's error boundary, and the pending skeleton covers
 * the wait, exactly as before SSR. On the server the same work is bounded and
 * fault-tolerant — a slow or failing API degrades the document (client-side
 * loading takes over after hydration) instead of holding the response open or
 * failing the request.
 */
export async function settlePreloads(
  preloads: ReadonlyArray<Promise<unknown>>
): Promise<PreloadOutcome> {
  if (!isServerRender()) {
    await Promise.all(preloads);
    return { degraded: false };
  }

  const settled = Promise.allSettled(preloads);
  let timedOut = false;
  const budget = new Promise<void>((resolve) => {
    setTimeout(() => {
      timedOut = true;
      resolve();
    }, SSR_PRELOAD_BUDGET_MS);
  });

  const results = await Promise.race([settled, budget.then(() => undefined)]);

  // The preloads are not abandoned: whatever lands late still populates the
  // request's collections, which are cleaned up when the render finishes.
  void settled.catch(() => undefined);

  return {
    degraded:
      timedOut ||
      results?.some((result) => result.status === "rejected") === true,
  };
}

/**
 * Runs a route's preloads and records server-side degradation on the request's
 * scope.
 *
 * The layout decides the document's cache and index policy after every match
 * has loaded, so a route's own outcome has to reach it: a page that renders
 * from a timed-out preload is incomplete even when the shell loaded fine.
 * Client-side degradation cannot happen (there the same failure rejects the
 * navigation), so this only ever marks a server render.
 */
async function preloadsFor(
  client: DbClient,
  preloads: ReadonlyArray<Promise<unknown>>
): Promise<PreloadOutcome> {
  const outcome = await settlePreloads(preloads);

  if (outcome.degraded) {
    markBoardPreloadDegraded(client);
  }

  return outcome;
}

/**
 * The board shell's data.
 *
 * Every board route renders the sidebar's boards, the status filters, the post
 * list and its upvote counts, so the shell preloads them as normalized rows:
 * one hydration payload serves every projection the page runs over them
 * (counts, group-bys, filtered lists).
 */
export function preloadBoardShell(client: DbClient) {
  return preloadsFor(client, [
    client.collection(publicBoardDescriptor).preload(),
    client.collection(publicPostDescriptor).preload(),
    client.collection(publicPostStatusDescriptor).preload(),
    client.collection(publicUpvoteDescriptor).preload(),
  ]);
}

export function preloadBoardRoadmap(client: DbClient) {
  return preloadsFor(client, [
    client.collection(publicBoardDescriptor).preload(),
    client.collection(publicPostDescriptor).preload(),
    client.collection(publicPostStatusDescriptor).preload(),
    client.collection(publicUpvoteDescriptor).preload(),
    client.collection(publicRoadmapDescriptor).preload(),
    client.collection(publicRoadmapColumnDescriptor).preload(),
  ]);
}

export function preloadBoardChangelog(client: DbClient) {
  return preloadsFor(client, [
    client.collection(publicChangelogDescriptor).preload(),
    client.collection(publicChangelogCategoryDescriptor).preload(),
    client.collection(publicChangelogCategoryLinkDescriptor).preload(),
  ]);
}

/**
 * Single-entry changelog detail.
 *
 * `publicChangelogDetailCollection` is on-demand, so its source preload is a
 * no-op: the live query is what pushes the slug-scoped subset into the
 * collection, and the rows that land there are what the render hydrates.
 */
export function preloadChangelogDetail(
  client: DbClient,
  options: { organizationId: string; slug: string }
) {
  const { organizationId, slug } = options;

  return preloadsFor(client, [
    client.collection(publicChangelogCategoryDescriptor).preload(),
    client.collection(publicChangelogCategoryLinkDescriptor).preload(),
    // Mirror the detail page's query exactly: a live-query snapshot is keyed
    // by the query's identity, so the browser only consumes this one if the
    // page builds the same query.
    client.preloadLiveQuery({
      query: (query) =>
        query
          .from({ changelog: publicChangelogDetailDescriptor })
          .where(({ changelog }) =>
            and(
              eq(changelog.organizationId, organizationId),
              eq(changelog.slug, slug)
            )
          )
          .findOne(),
    }),
  ]);
}

/**
 * Post detail's per-user state.
 *
 * `PostSubscription` has no `postSlug` column, so it loads org-scoped and the
 * subscribe toggle narrows it to the viewed post. Delete hints are the
 * creator-only affordance; both are skipped for signed-out visitors, whose
 * queries resolve to nothing anyway.
 */
export function preloadPostUserState(
  client: DbClient,
  options: { organizationId: string }
) {
  const { organizationId } = options;

  return preloadsFor(client, [
    client.collection(publicDeleteEligibilityDescriptor).preload(),
    client.preloadLiveQuery({
      query: (query) =>
        query
          .from({ subscription: publicPostSubscriptionDescriptor })
          .where(({ subscription }) =>
            eq(subscription.organizationId, organizationId)
          ),
    }),
  ]);
}

/**
 * Post detail's slug-scoped subsets.
 *
 * Each on-demand collection is loaded through a live query, because
 * `collection.preload()` is a no-op without a subscriber. The queries mirror
 * what the page's components subscribe to (org-scoped, slug-scoped where the
 * collection carries `postSlug`), so the rows that arrive are the rows the
 * render reads.
 */
export function preloadPostDetail(
  client: DbClient,
  options: { organizationId: string; slug: string }
) {
  const { organizationId, slug } = options;

  return preloadsFor(client, [
    client.collection(publicBoardDescriptor).preload(),
    client.collection(publicPostStatusDescriptor).preload(),
    client.collection(publicTagDescriptor).preload(),
    client.preloadLiveQuery({
      query: (query) =>
        query
          .from({ post: publicPostDetailDescriptor })
          .where(({ post }) =>
            and(eq(post.organizationId, organizationId), eq(post.slug, slug))
          ),
    }),
    client.preloadLiveQuery({
      query: (query) =>
        query
          .from({ comment: publicCommentDescriptor })
          .where(({ comment }) =>
            and(
              eq(comment.organizationId, organizationId),
              eq(comment.postSlug, slug)
            )
          ),
    }),
    client.preloadLiveQuery({
      query: (query) =>
        query
          .from({ commentReaction: publicCommentReactionDescriptor })
          .where(({ commentReaction }) =>
            and(
              eq(commentReaction.organizationId, organizationId),
              eq(commentReaction.postSlug, slug)
            )
          ),
    }),
    client.preloadLiveQuery({
      query: (query) =>
        query
          .from({ postReaction: publicPostReactionDescriptor })
          .where(({ postReaction }) =>
            and(
              eq(postReaction.organizationId, organizationId),
              eq(postReaction.postSlug, slug)
            )
          ),
    }),
    // Tag assignments, slug-scoped upvotes and subscriptions carry no
    // `postSlug` column: they load org-scoped and the component's subscription
    // narrows them to the viewed post.
    client.preloadLiveQuery({
      query: (query) =>
        query
          .from({ postTag: publicPostTagDescriptor })
          .where(({ postTag }) => eq(postTag.organizationId, organizationId)),
    }),
    client.preloadLiveQuery({
      query: (query) =>
        query
          .from({ upvote: publicPostUpvoteDescriptor })
          .where(({ upvote }) => eq(upvote.organizationId, organizationId)),
    }),
  ]);
}
