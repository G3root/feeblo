import { createAsync } from "@solidjs/router";
import { Show } from "solid-js";
import { BoardList } from "../components/board-list/board-list";
import { fetchBoards } from "../lib/api";

export function IndexComponent() {
  const boards = createAsync(() => fetchBoards());

  return (
    <Show
      fallback={
        <div class="p-6 text-muted-foreground text-sm">Loading boards...</div>
      }
      keyed
      when={boards()}
    >
      {(boards) => <BoardList boards={boards} />}
    </Show>
  );
}

export default IndexComponent;
