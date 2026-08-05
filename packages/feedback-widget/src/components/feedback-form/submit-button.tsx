import { Button } from "../ui/button";
import { Icon } from "../ui/icon";
import { useFeedbackForm } from "./context";

export function FeedbackFormSubmitButton() {
  const { state } = useFeedbackForm();

  return (
    <Button disabled={state.submission.pending} type="submit">
      <Icon class="size-4" name="SentIcon" />
      {state.submission.pending ? "Creating..." : "Create a new post"}
    </Button>
  );
}
