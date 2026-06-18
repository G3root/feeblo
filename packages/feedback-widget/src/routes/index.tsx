import { BoardList } from "../components/board-list/board-list";
import { boards } from "../lib/boards";

export function IndexComponent() {
  return <BoardList boards={boards} />;
}
