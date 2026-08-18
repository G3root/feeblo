import { A } from "@solidjs/router";

import type { Board } from "../../lib/boards";

export function BoardCard(props: { board: Board }) {
  return (
    <A
      aria-label={props.board.name}
      class="group border-border text-foreground hover:bg-muted/50 focus-visible:ring-ring/30 relative flex w-full items-center gap-3 rounded-lg border p-3 text-base font-medium transition-colors focus-visible:ring-3 dark:hover:bg-white/5"
      draggable={false}
      href={`/board/${props.board.id}`}
    >
      <span class="truncate">{props.board.name}</span>
    </A>
  );
}
