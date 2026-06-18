import { A } from "@solidjs/router";
import type { Board } from "../../lib/boards";
import { IconPlaceholder } from "../ui/icon-placeholder";

export function BoardCard(props: { board: Board }) {
  return (
    <A
      aria-label={props.board.name}
      class="group relative flex w-full items-center gap-3 rounded-lg border border-border p-3 font-medium text-base text-foreground transition-colors hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/30 dark:hover:bg-white/5"
      draggable={false}
      href={`/board/${props.board.id}`}
    >
      <span class="text-muted-foreground/60 dark:text-muted-foreground/50">
        <IconPlaceholder class="size-4" />
      </span>
      <span class="flex w-full justify-between">
        <span class="truncate">{props.board.name}</span>
        <code class="my-auto rounded-none border-border border-l bg-transparent pr-2 pl-3 font-mono text-muted-foreground/80 text-sm dark:border-white/5 dark:text-muted-foreground/60">
          {props.board.count}
        </code>
      </span>
    </A>
  );
}
