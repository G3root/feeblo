import { authClient } from "@feeblo/web-shared/auth-client";
import {
  getAuthSession,
  refreshAuthSession,
} from "@feeblo/web-shared/auth-session";
import { and, createLiveQueryCollection, eq } from "@tanstack/react-db";
import { createRootRoute, createRoute, Outlet } from "@tanstack/react-router";
import * as S from "effect/Schema";

import { PublicBoardShell } from "../components/layout/public-board-shell";
import {
  getCurrentOrganizationId,
  publicBoardCollection,
  publicChangelogCategoryCollection,
  publicChangelogCategoryLinkCollection,
  publicChangelogCollection,
  publicCommentCollection,
  publicCommentReactionCollection,
  publicPostCollection,
  publicPostReactionCollection,
  publicPostStatusCollection,
  publicPostTagCollection,
  publicRoadmapCollection,
  publicRoadmapColumnCollection,
  publicTagCollection,
  publicUpvoteCollection,
  publicPostSubscriptionCollection,
} from "../lib/collections";
import { NotFoundPage } from "../routes/not-found-page";
import { getSsoTokenFromHash, removeSsoTokenFromHash } from "./sso-token";

/**
 * Same on-demand preload treatment as the dashboard post route. These public
 * collections are `syncMode: "on-demand"`, so `collection.preload()` is a
 * no-op — their slug-scoped subset only loads when a live query subscribes,
 * which happens after the route component mounts. Building the slug-scoped
 * queries here and preloading them in `beforeLoad` fetches them alongside the
 * eager collections instead of after the pending loader clears.
 */
function createPublicPostSubsetQueries(slug: string) {
  const organizationId = getCurrentOrganizationId() ?? "";

  return {
    commentReactions: createLiveQueryCollection((query) =>
      query
        .from({ commentReaction: publicCommentReactionCollection })
        .where(({ commentReaction }) =>
          and(
            eq(commentReaction.organizationId, organizationId),
            eq(commentReaction.postSlug, slug)
          )
        )
    ),
    comments: createLiveQueryCollection((query) =>
      query
        .from({ comment: publicCommentCollection })
        .where(({ comment }) =>
          and(
            eq(comment.organizationId, organizationId),
            eq(comment.postSlug, slug)
          )
        )
    ),
    postReactions: createLiveQueryCollection((query) =>
      query
        .from({ postReaction: publicPostReactionCollection })
        .where(({ postReaction }) =>
          and(
            eq(postReaction.organizationId, organizationId),
            eq(postReaction.postSlug, slug)
          )
        )
    ),
    // PostSubscription has no `postSlug` column; its query key falls back to
    // the current URL slug, which is what the subscribe toggle relies on too.
    // An org-scoped load is enough to resolve that same slug key.
    postSubscription: createLiveQueryCollection((query) =>
      query
        .from({ subscription: publicPostSubscriptionCollection })
        .where(({ subscription }) =>
          eq(subscription.organizationId, organizationId)
        )
    ),
  };
}

const rootRoute = createRootRoute({
  beforeLoad: async () => {
    const url = new URL(window.location.href);
    const token = getSsoTokenFromHash(url.hash);
    if (token !== null) {
      url.hash = removeSsoTokenFromHash(url.hash);
      window.history.replaceState(window.history.state, "", url);
    }

    const organizationId = getCurrentOrganizationId();
    let session = await getAuthSession();

    if (
      token &&
      organizationId &&
      session?.user.restrictedToOrganizationId !== organizationId
    ) {
      const result = await authClient.signIn.jwtAutoLogin({
        organizationId,
        token,
      });
      if (result.error) {
        throw new Error(result.error.message ?? "Feeblo auto-login failed");
      }
      session = await refreshAuthSession();
    }

    const restrictedToOrganizationId =
      session?.user?.restrictedToOrganizationId;

    if (
      restrictedToOrganizationId &&
      organizationId &&
      restrictedToOrganizationId !== organizationId
    ) {
      await authClient.signOut();
      await refreshAuthSession();
    }
  },
  component: () => (
    <PublicBoardShell>
      <Outlet />
    </PublicBoardShell>
  ),
});

const HomeSearchSchema = S.toStandardSchemaV1(
  S.Struct({
    board: S.String.pipe(S.optional),
    sort: S.String.pipe(S.optional),
    status: S.String.pipe(S.optional),
  })
);

const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  validateSearch: HomeSearchSchema,
  beforeLoad: async () => {
    await Promise.all([
      publicBoardCollection.preload(),
      publicUpvoteCollection.preload(),
      publicPostCollection.preload(),
      publicPostStatusCollection.preload(),
    ]);

    return null;
  },
}).lazy(() => import("../routes/home-page").then((d) => d.Route));

const roadmapRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/roadmap",
  beforeLoad: async () => {
    await Promise.all([
      publicBoardCollection.preload(),
      publicUpvoteCollection.preload(),
      publicPostCollection.preload(),
      publicPostStatusCollection.preload(),
      publicRoadmapCollection.preload(),
      publicRoadmapColumnCollection.preload(),
    ]);

    return null;
  },
}).lazy(() => import("../routes/roadmap-page").then((d) => d.Route));

const boardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/b/$boardSlug",

  beforeLoad: async () => {
    await Promise.all([
      publicBoardCollection.preload(),
      publicUpvoteCollection.preload(),
      publicPostCollection.preload(),
      publicPostStatusCollection.preload(),
    ]);

    return null;
  },
}).lazy(() => import("../routes/board-page").then((d) => d.Route));

const roadmapSlugRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/roadmap/$slug",
  beforeLoad: async () => {
    await Promise.all([
      publicBoardCollection.preload(),
      publicUpvoteCollection.preload(),
      publicPostCollection.preload(),
      publicPostStatusCollection.preload(),
      publicRoadmapCollection.preload(),
      publicRoadmapColumnCollection.preload(),
    ]);

    return null;
  },
}).lazy(() => import("../routes/roadmap-slug-page").then((d) => d.Route));

const postRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/p/$slug",
  beforeLoad: async (params) => {
    const { slug } = params;
    const subsetQueries = createPublicPostSubsetQueries(slug);

    await Promise.all([
      publicBoardCollection.preload(),
      publicUpvoteCollection.preload(),
      publicPostCollection.preload(),
      publicPostStatusCollection.preload(),
      publicPostTagCollection.preload(),
      publicTagCollection.preload(),
      subsetQueries.comments.preload(),
      subsetQueries.commentReactions.preload(),
      subsetQueries.postReactions.preload(),
      subsetQueries.postSubscription.preload(),
    ]);

    return null;
  },
}).lazy(() => import("../routes/post-page").then((d) => d.Route));

const changelogRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/changelog",
  beforeLoad: async () => {
    await Promise.all([
      publicChangelogCollection.preload(),
      publicChangelogCategoryCollection.preload(),
      publicChangelogCategoryLinkCollection.preload(),
    ]);
    return null;
  },
}).lazy(() => import("../routes/change-log-page").then((d) => d.Route));

const changelogDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/changelog/$changelogSlug",
  beforeLoad: async () => {
    await Promise.all([
      publicChangelogCollection.preload(),
      publicChangelogCategoryCollection.preload(),
      publicChangelogCategoryLinkCollection.preload(),
    ]);
    return null;
  },
}).lazy(() => import("../routes/change-log-detail-page").then((d) => d.Route));

const notFoundRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "*",
  component: () => <NotFoundPage />,
});

export const routeTree = rootRoute.addChildren([
  homeRoute,
  roadmapRoute,
  roadmapSlugRoute,
  boardRoute,
  postRoute,
  changelogRoute,
  changelogDetailRoute,
  notFoundRoute,
]);
