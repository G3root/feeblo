import { Route, Switch } from "wouter";
import { useSite } from "../providers/site-provider";
import { BoardPage } from "../routes/board-page";
import { ChangeLogDetailPage } from "../routes/change-log-detail-page";
import { ChangelogPage } from "../routes/change-log-page";
import { HomePage } from "../routes/home-page";
import { NotFoundPage } from "../routes/not-found-page";
import { PostPage } from "../routes/post-page";
import { RoadmapPage } from "../routes/roadmap-page";

export function PublicBoardRoutes() {
  const site = useSite();

  return (
    <Switch>
      <Route path="/">
        <HomePage />
      </Route>
      {site.changelogVisibility === "PUBLIC" ? (
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
  );
}
