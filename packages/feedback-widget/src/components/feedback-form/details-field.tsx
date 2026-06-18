import { Textarea } from "../ui/textarea";
import { useFeedbackForm } from "./context";

export function FeedbackFormDetailsField() {
  const {
    state: { details },
    actions: { setDetails },
  } = useFeedbackForm();
  return (
    <Textarea
      onChange={(event) => setDetails(event.target.value)}
      placeholder="Help us understand what value this feature would bring to your team or workflow"
      value={details}
    />
  );
}
