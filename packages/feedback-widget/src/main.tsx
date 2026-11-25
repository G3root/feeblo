import { HashRouter, Route } from "@solidjs/router";
import { lazy } from "solid-js";

import { preloadBoards, preloadHelpCenter, preloadUpdates } from "./lib/api";
import { RootComponent } from "./routes/__root";

export { isSupportedLocale, type WidgetConfig } from "./lib/config";

const HomeRoute = lazy(() => import("./routes/index"));

const LazyBoardDetail = lazy(() => import("./routes/board"));

const LazyUpdates = lazy(() => import("./routes/updates"));

const LazyUpdateDetail = lazy(() => import("./routes/update-detail"));

const LazyHelp = lazy(() => import("./routes/help"));

const LazyHelpArticle = lazy(() => import("./routes/help-article"));

export function WidgetApp() {
  return (
    <HashRouter root={RootComponent}>
      <Route component={HomeRoute} path="/" preload={preloadBoards} />
      <Route
        component={LazyBoardDetail}
        path="/board/:boardId"
        preload={preloadBoards}
      />
      <Route component={LazyUpdates} path="/updates" preload={preloadUpdates} />
      <Route
        component={LazyUpdateDetail}
        path="/updates/:updateId"
        preload={preloadUpdates}
      />
      <Route component={LazyHelp} path="/help" preload={preloadHelpCenter} />
      <Route
        component={LazyHelpArticle}
        path="/help/:articleSlug"
        preload={preloadHelpCenter}
      />
    </HashRouter>
  );
}
