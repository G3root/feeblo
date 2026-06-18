import { Input } from "../ui/input";
import { useFeedbackForm } from "./context";

export function FeedbackFormTitleField() {
  const {
    state: { title },
    actions: { setTitle },
  } = useFeedbackForm();
  return (
    <Input
      onChange={(event) => setTitle(event.target.value)}
      placeholder="Share your product feedback!"
      value={title}
    />
  );
}
