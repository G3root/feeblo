import { Route, Switch } from "wouter";
import { BoardPage } from "../routes/board-page";
import { HomePage } from "../routes/home-page";
import { NotFoundPage } from "../routes/not-found-page";
import { PostPage } from "../routes/post-page";
import { RoadmapPage } from "../routes/roadmap-page";
export function PublicBoardRoutes() {
  return (
    <Switch>
      <Route path="/">
        <HomePage />
      </Route>
      <Route path="/roadmap">
        <RoadmapPage />
      </Route>
      <Route path="/b/:boardSlug">
        {(params) => <BoardPage boardSlug={params.boardSlug} />}
      </Route>
      <Route path="/p/:slug">
        {(params) => <PostPage slug={params.slug} />}
      </Route>
      <Route>
        <NotFoundPage />
      </Route>
    </Switch>
  );
}
