import { Input } from "../ui/input";
import { useFeedbackForm } from "./context";

export function FeedbackFormTitleField() {
  const { actions } = useFeedbackForm();

  return (
    <Input
      name="title"
      onInput={(event) => actions.setTitle(event.currentTarget.value)}
      placeholder="Share your product feedback!"
      required
    />
  );
}
