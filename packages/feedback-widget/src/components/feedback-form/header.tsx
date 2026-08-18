import { useFeedbackForm } from "./context";

export function FeedbackFormHeader() {
  const { meta } = useFeedbackForm();

  return (
    <div class="mb-5 flex gap-2.5">
      {/* <span class="text-muted-foreground/60 dark:text-muted-foreground/50">
        <Icon class="size-4" name="MessageSquare" />
      </span> */}
      <p class="text-foreground text-lg font-medium first-letter:uppercase">
        {meta.board.name}
      </p>
    </div>
  );
}
