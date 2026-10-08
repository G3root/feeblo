import { A } from "@solidjs/router";

import type { Board } from "../../lib/boards";
import { Icon } from "../ui/icon";

export function BoardCard(props: { board: Board }) {
  return (
    <A
      class="group border-border bg-card text-foreground hover:border-foreground/20 hover:bg-accent/40 focus-visible:ring-ring/30 ease-widget-out flex w-full items-center gap-3 rounded-xl border p-3.5 text-base font-medium transition-[border-color,background-color,transform] duration-150 outline-none focus-visible:ring-[3px] active:scale-[0.98] motion-reduce:active:scale-100"
      draggable={false}
      href={`/board/${props.board.id}`}
    >
      <span class="min-w-0 flex-1 truncate">{props.board.name}</span>
      <Icon
        class="text-muted-foreground/50 size-4 transition-transform duration-150 group-hover:translate-x-0.5 motion-reduce:transition-none"
        name="ArrowRight01Icon"
      />
    </A>
  );
}
