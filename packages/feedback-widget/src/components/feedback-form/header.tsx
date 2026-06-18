import { HugeiconsIcon } from "@hugeicons/react";

import { useFeedbackForm } from "./context";

export function FeedbackFormHeader() {
  const {
    meta: { board },
  } = useFeedbackForm();
  return (
    <div className="mb-5 flex gap-2.5">
      <span className="text-muted-foreground/60 dark:text-muted-foreground/50">
        <HugeiconsIcon className="size-4" icon={board.icon} />
      </span>
      <p className="font-medium text-foreground text-lg first-letter:uppercase">
        {board.name}
      </p>
    </div>
  );
}
