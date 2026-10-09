import { Button } from "../ui/button";
import { Icon } from "../ui/icon";
import { useFeedbackForm } from "./context";

export function FeedbackFormSubmitButton() {
  const { state } = useFeedbackForm();

  return (
    <Button
      class="w-full"
      loading={Boolean(state.submission.pending)}
      type="submit"
    >
      <Icon class="size-4" name="SentIcon" />
      Create a new post
    </Button>
  );
}
