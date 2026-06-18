import { Input } from "../ui/input";
import { useFeedbackForm } from "./context";

export function FeedbackFormTitleField() {
  const form = useFeedbackForm();
  return (
    <Input
      onInput={(event) => form.actions.setTitle(event.currentTarget.value)}
      placeholder="Share your product feedback!"
      value={form.state.title}
    />
  );
}
