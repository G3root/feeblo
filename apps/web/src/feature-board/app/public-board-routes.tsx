import { lazy, Suspense } from "react";
import { Route, Switch } from "wouter";
import { useSite } from "../providers/site-provider";

const BoardPage = lazy(() =>
  import("../routes/board-page").then((mod) => ({ default: mod.BoardPage }))
);
const ChangeLogDetailPage = lazy(() =>
  import("../routes/change-log-detail-page").then((mod) => ({
    default: mod.ChangeLogDetailPage,
  }))
);
const ChangelogPage = lazy(() =>
  import("../routes/change-log-page").then((mod) => ({
    default: mod.ChangelogPage,
  }))
);
const HomePage = lazy(() =>
  import("../routes/home-page").then((mod) => ({ default: mod.HomePage }))
);
const NotFoundPage = lazy(() =>
  import("../routes/not-found-page").then((mod) => ({
    default: mod.NotFoundPage,
  }))
);
const PostPage = lazy(() =>
  import("../routes/post-page").then((mod) => ({ default: mod.PostPage }))
);
const RoadmapPage = lazy(() =>
  import("../routes/roadmap-page").then((mod) => ({
    default: mod.RoadmapPage,
  }))
);

export function PublicBoardRoutes() {
  const site = useSite();

  return (
    <Suspense fallback={null}>
      <Switch>
        <Route path="/">
          <HomePage />
        </Route>
        {site.roadmapVisibility === "PUBLIC" ? (
          <Route path="/roadmap">
            <RoadmapPage />
          </Route>
        ) : null}
        <Route path="/b/:boardSlug">
          {(params) => <BoardPage boardSlug={params.boardSlug} />}
        </Route>
        <Route path="/p/:slug">
          {(params) => <PostPage slug={params.slug} />}
        </Route>
        {site.changelogVisibility === "PUBLIC" ? (
          <Route path="/changelog">
            <ChangelogPage />
          </Route>
        ) : null}
        {site.changelogVisibility === "PUBLIC" ? (
          <Route path="/changelog/:changelogSlug">
            {(params) => (
              <ChangeLogDetailPage changelogSlug={params.changelogSlug} />
            )}
          </Route>
        ) : null}
        <Route>
          <NotFoundPage />
        </Route>
      </Switch>
    </Suspense>
  );
}
