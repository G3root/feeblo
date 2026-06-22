import { HashRouter, Route } from "@solidjs/router";
import { lazy } from "solid-js";
import { preloadBoards } from "./lib/api";
import { RootComponent } from "./routes/__root";

const HomeRoute = lazy(() => import("./routes/index"));
const LazyBoardDetail = lazy(() => import("./routes/board"));

export function WidgetApp() {
  return (
    <HashRouter root={RootComponent}>
      <Route component={HomeRoute} path="/" preload={preloadBoards} />
      <Route
        component={LazyBoardDetail}
        path="/board/:boardId"
        preload={preloadBoards}
      />
    </HashRouter>
  );
}
