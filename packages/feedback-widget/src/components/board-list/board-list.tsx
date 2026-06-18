/** biome-ignore-all lint/style/noExportedImports: <explanation> */
import { For } from "solid-js";
import type { Board } from "../../lib/boards";
import { BoardCard } from "./board-card";
import { PoweredByBadge } from "./powered-by-badge";

export function BoardList(props: { boards: Board[] }) {
  return (
    <div class="p-6">
      <p class="font-medium text-foreground text-lg">Give us feedback</p>
      <p class="mt-1 max-w-xs text-muted-foreground text-sm">
        Tell us how we could make the product more useful for you.
      </p>

      <div class="mt-6 space-y-3">
        <For each={props.boards}>
          {(board) => <BoardCard board={board} />}
        </For>
      </div>

      <PoweredByBadge />
    </div>
  );
}

export { BoardCard, PoweredByBadge };
