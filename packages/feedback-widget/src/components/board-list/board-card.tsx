import { HugeiconsIcon } from "@hugeicons/react";
import { Link } from "@tanstack/react-router";

import type { Board } from "../../lib/boards";

export function BoardCard({ board }: { board: Board }) {
  return (
    <Link
      aria-label={board.name}
      className="group relative flex w-full items-center gap-3 rounded-lg border border-border p-3 font-medium text-base text-foreground transition-colors hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/30 dark:hover:bg-white/5"
      draggable={false}
      params={{ boardId: board.id }}
      to="/board/$boardId"
    >
      <span className="text-muted-foreground/60 dark:text-muted-foreground/50">
        <HugeiconsIcon className="size-4" icon={board.icon} />
      </span>
      <span className="flex w-full justify-between">
        <span className="truncate">{board.name}</span>
        <code className="my-auto rounded-none border-border border-l bg-transparent pr-2 pl-3 font-mono text-muted-foreground/80 text-sm dark:border-white/5 dark:text-muted-foreground/60">
          {board.count}
        </code>
      </span>
    </Link>
  );
}
