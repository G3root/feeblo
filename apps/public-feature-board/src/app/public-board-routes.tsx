import {
  clearAuthStateCache,
  initAuthStateCache,
} from "@feeblo/web-shared/auth-client";
import { createRootRoute, createRoute, Outlet } from "@tanstack/react-router";
import * as S from "effect/Schema";
import { PublicBoardShell } from "../components/layout/public-board-shell";
import {
  getCurrentOrganizationId,
  publicBoardCollection,
  publicChangelogCollection,
  publicPostCollection,
  publicPostStatusCollection,
  publicPostTagCollection,
  publicTagCollection,
  publicUpvoteCollection,
} from "../lib/collections";
import { NotFoundPage } from "../routes/not-found-page";

const rootRoute = createRootRoute({
  beforeLoad: async () => {
    const session = await initAuthStateCache();
    const restrictedToOrganizationId =
      session?.user?.restrictedToOrganizationId;
    const organizationId = getCurrentOrganizationId();

    if (
      restrictedToOrganizationId &&
      organizationId &&
      restrictedToOrganizationId !== organizationId
    ) {
      clearAuthStateCache();
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
    ]);

    return null;
  },
}).lazy(() => import("../routes/post-page").then((d) => d.Route));

const changelogRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/changelog",
  beforeLoad: async () => {
    await Promise.all([publicChangelogCollection.preload()]);
    return null;
  },
}).lazy(() => import("../routes/change-log-page").then((d) => d.Route));

const changelogDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/changelog/$changelogSlug",
  beforeLoad: async () => {
    await Promise.all([publicChangelogCollection.preload()]);
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
  boardRoute,
  postRoute,
  changelogRoute,
  changelogDetailRoute,
  notFoundRoute,
]);
