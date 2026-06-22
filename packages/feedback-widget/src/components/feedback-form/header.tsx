import type { Board } from "../../lib/boards";
import { IconPlaceholder } from "../ui/icon-placeholder";

export function FeedbackFormHeader(props: { board: Board }) {
  return (
    <div class="mb-5 flex gap-2.5">
      <span class="text-muted-foreground/60 dark:text-muted-foreground/50">
        <IconPlaceholder class="size-4" />
      </span>
      <p class="font-medium text-foreground text-lg first-letter:uppercase">
        {props.board.name}
      </p>
    </div>
  );
}
