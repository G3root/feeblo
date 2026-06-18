import { Textarea } from "../ui/textarea";
import { useFeedbackForm } from "./context";

export function FeedbackFormDetailsField() {
  const form = useFeedbackForm();
  return (
    <Textarea
      onInput={(event) => form.actions.setDetails(event.currentTarget.value)}
      placeholder="Help us understand what value this feature would bring to your team or workflow"
      value={form.state.details}
    />
  );
}
