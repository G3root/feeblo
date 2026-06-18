import { IconPlaceholder } from "../ui/icon-placeholder";
import { buttonVariants } from "../ui/button";
import { useFeedbackForm } from "./context";

export function FeedbackFormSubmitButton() {
  const form = useFeedbackForm();
  return (
    <button
      class={buttonVariants({ variant: "default", size: "default" })}
      disabled={!form.meta.canSubmit}
      onClick={() => form.actions.submit()}
      type="button"
    >
      <IconPlaceholder class="-mt-1 size-4 -rotate-45" />
      Create a new post
    </button>
  );
}
