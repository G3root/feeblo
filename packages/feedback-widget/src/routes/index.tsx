import { createAsync } from "@solidjs/router";
import { Show } from "solid-js";

import { BoardList } from "../components/board-list/board-list";
import { UpdatesList } from "../components/updates/updates-list";
import { fetchBoards } from "../lib/api";
import { getWidgetConfig } from "../lib/config";

export function IndexComponent() {
  const config = getWidgetConfig();
  if (config.mode === "updates" || !config.modules.includes("feedback")) {
    return <UpdatesList />;
  }
  const boards = createAsync(() => fetchBoards());

  return (
    <Show
      fallback={
        <div class="text-muted-foreground p-6 text-sm">Loading boards...</div>
      }
      keyed
      when={boards()}
    >
      {(boards) => <BoardList boards={boards} />}
    </Show>
  );
}

export default IndexComponent;
