import type { Site } from "@feeblo/domain/site/schema";
import { Route, Router } from "@solidjs/router";
import { SiteProvider } from "src/providers/site-provider";
import { PublicBoardShell } from "../components/layout/public-board-shell";
import { HomePage } from "../routes/home-page";
import { PostPage } from "../routes/post-page";
import { RoadmapPage } from "../routes/roadmap-page";
export interface PublicBoardAppProps {
  readonly basePath?: string;
  readonly site: Site;
}

export function PublicBoardApp(props: PublicBoardAppProps) {
  return (
    <SiteProvider site={props.site}>
      <Router base={props.basePath} root={PublicBoardShell}>
        <Route component={HomePage} path="/" />
        <Route component={RoadmapPage} path="/roadmap" />
        <Route component={PostPage} path="/p/:slug" />
      </Router>
    </SiteProvider>
  );
}
