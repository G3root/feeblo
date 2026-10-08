import { For, Show } from "solid-js";

import type { Board } from "../../lib/boards";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { BoardCard } from "./board-card";

/**
 * The feedback surface's root: one row per public board. The stagger index is
 * capped so a long list does not make its last row wait on its first.
 */
export function BoardList(props: { boards: readonly Board[] }) {
  return (
    <div class="p-6">
      <header>
        <h1 class="text-foreground text-lg font-medium">Give us feedback</h1>
        <p class="text-muted-foreground mt-1 max-w-xs text-sm">
          Pick a board and share what you would like us to build next.
        </p>
      </header>

      <Show
        fallback={
          <Empty class="mt-6 border">
            <EmptyHeader>
              <EmptyTitle>No boards yet</EmptyTitle>
              <EmptyDescription>
                There is no public board to post to yet.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        }
        when={props.boards.length > 0}
      >
        <ul class="mt-6 flex flex-col gap-2.5">
          <For each={props.boards}>
            {(board, index) => (
              <li
                class="widget-stagger"
                style={{ "--stagger": Math.min(index(), 6) }}
              >
                <BoardCard board={board} />
              </li>
            )}
          </For>
        </ul>
      </Show>
    </div>
  );
}
