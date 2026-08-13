import { WIDGET_CONTENT_MAX_LENGTH } from "@feeblo/domain/content-limits";
import { Textarea } from "../ui/textarea";
import { useFeedbackForm } from "./context";

export function FeedbackFormContentField() {
  const { actions } = useFeedbackForm();

  return (
    <Textarea
      maxLength={WIDGET_CONTENT_MAX_LENGTH}
      name="content"
      onInput={(event) => actions.setContent(event.currentTarget.value)}
      placeholder="Help us understand what value this feature would bring to your team or workflow"
    />
  );
}
