import { authClient } from "@feeblo/web-shared/auth-client";
import {
  getAuthSession,
  refreshAuthSession,
} from "@feeblo/web-shared/auth-session";
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
} from "../lib/collections";
import { NotFoundPage } from "../routes/not-found-page";

/**
 * Reads the SSO token from the URL fragment. The SDK puts it there (rather
 * than in the query string) so it is never sent to the server or leaked via
 * the Referer header. It is removed from history before render below.
 */
function getSsoTokenFromHash(hash: string): string | null {
  if (!hash.startsWith("#")) {
    return null;
  }
  const params = new URLSearchParams(hash.slice(1));
  return params.get("ssoToken");
}

const rootRoute = createRootRoute({
  beforeLoad: async () => {
    const url = new URL(window.location.href);
    const token = getSsoTokenFromHash(url.hash);
    const organizationId = getCurrentOrganizationId();
    let session = await getAuthSession();

    if (token && organizationId) {
      url.hash = "";
      window.history.replaceState(window.history.state, "", url);

      if (session?.user.restrictedToOrganizationId !== organizationId) {
        const result = await authClient.signIn.jwtAutoLogin({
          organizationId,
          token,
        });
        if (result.error) {
          throw new Error(result.error.message ?? "Feeblo auto-login failed");
        }
        session = await refreshAuthSession();
      }
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
  beforeLoad: async () => {
    await Promise.all([
      publicBoardCollection.preload(),
      publicUpvoteCollection.preload(),
      publicPostCollection.preload(),
      publicPostStatusCollection.preload(),
      publicPostTagCollection.preload(),
      publicTagCollection.preload(),
      publicCommentCollection.preload(),
      publicCommentReactionCollection.preload(),
      publicPostReactionCollection.preload(),
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
