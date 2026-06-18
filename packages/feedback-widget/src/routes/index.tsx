import { createRoute } from "@tanstack/react-router";
import { BoardList } from "../components/board-list/board-list";
import { boards } from "../lib/boards";
import { rootRoute } from "./__root";

export const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: BoardListComponent,
});

function BoardListComponent() {
  return <BoardList boards={boards} />;
}
