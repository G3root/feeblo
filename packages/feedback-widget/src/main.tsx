import { HashRouter, Route } from "@solidjs/router";
import { lazy } from "solid-js";
import { preloadBoards } from "./lib/api";
import { RootComponent } from "./routes/__root";

export {
  isSupportedLocale,
  type WidgetConfig,
} from "./lib/config";

const HomeRoute = lazy(() => import("./routes/index"));
const LazyBoardDetail = lazy(() => import("./routes/board"));
const LazyUpdates = lazy(() => import("./routes/updates"));
const LazyUpdateDetail = lazy(() => import("./routes/update-detail"));

export function WidgetApp() {
  return (
    <HashRouter root={RootComponent}>
      <Route component={HomeRoute} path="/" preload={preloadBoards} />
      <Route
        component={LazyBoardDetail}
        path="/board/:boardId"
        preload={preloadBoards}
      />
      <Route component={LazyUpdates} path="/updates" />
      <Route component={LazyUpdateDetail} path="/updates/:updateId" />
    </HashRouter>
  );
}
