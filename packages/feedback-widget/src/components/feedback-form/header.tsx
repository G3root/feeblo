import { IconPlaceholder } from "../ui/icon-placeholder";
import { useFeedbackForm } from "./context";

export function FeedbackFormHeader() {
  const form = useFeedbackForm();
  return (
    <div class="mb-5 flex gap-2.5">
      <span class="text-muted-foreground/60 dark:text-muted-foreground/50">
        <IconPlaceholder class="size-4" />
      </span>
      <p class="font-medium text-foreground text-lg first-letter:uppercase">
        {form.meta.board.name}
      </p>
    </div>
  );
}
