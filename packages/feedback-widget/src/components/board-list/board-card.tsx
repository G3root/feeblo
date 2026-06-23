import { A } from "@solidjs/router";
import type { Board } from "../../lib/boards";

export function BoardCard(props: { board: Board }) {
  return (
    <A
      aria-label={props.board.name}
      class="group relative flex w-full items-center gap-3 rounded-lg border border-border p-3 font-medium text-base text-foreground transition-colors hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/30 dark:hover:bg-white/5"
      draggable={false}
      href={`/board/${props.board.id}`}
    >
      <span class="truncate">{props.board.name}</span>
    </A>
  );
}
