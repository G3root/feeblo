import { createRootRoute, createRoute, Outlet } from "@tanstack/react-router";
import { PublicBoardShell } from "../components/layout/public-board-shell";
import {
  publicBoardCollection,
  publicChangelogCollection,
  publicPostCollection,
  publicPostStatusCollection,
  publicPostTagCollection,
  publicTagCollection,
} from "../lib/collections";
import { NotFoundPage } from "../routes/not-found-page";

const rootRoute = createRootRoute({
  component: () => (
    <PublicBoardShell>
      <Outlet />
    </PublicBoardShell>
  ),
});

const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  validateSearch: (search: Record<string, unknown>) => ({
    board:
      typeof search.board === "string" ? search.board : (undefined as unknown),
    sort:
      typeof search.sort === "string" ? search.sort : (undefined as unknown),
    status:
      typeof search.status === "string"
        ? search.status
        : (undefined as unknown),
  }),
  beforeLoad: async () => {
    await Promise.all([
      publicBoardCollection.preload(),
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
