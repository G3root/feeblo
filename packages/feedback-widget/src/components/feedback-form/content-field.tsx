import { Textarea } from "../ui/textarea";
import { useFeedbackForm } from "./context";

export function FeedbackFormContentField() {
  const { actions } = useFeedbackForm();

  return (
    <Textarea
      name="content"
      onInput={(event) => actions.setContent(event.currentTarget.value)}
      placeholder="Help us understand what value this feature would bring to your team or workflow"
    />
  );
}
