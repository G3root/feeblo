import { For } from "solid-js";

import type { Board } from "../../lib/boards";
import { PoweredByBadge } from "../ui/powered-by-badge";
import { BoardCard } from "./board-card";

export function BoardList(props: { boards: Board[] }) {
  return (
    <div class="p-6">
      <p class="text-foreground text-lg font-medium">Give us feedback</p>
      <p class="text-muted-foreground mt-1 max-w-xs text-sm">
        Tell us how we could make the product more useful for you.
      </p>

      <div class="mt-6 space-y-3">
        <For each={props.boards}>{(board) => <BoardCard board={board} />}</For>
      </div>

      <PoweredByBadge />
    </div>
  );
}
