import { WIDGET_TITLE_MAX_LENGTH } from "@feeblo/domain/content-limits";

import { Input } from "../ui/input";
import { useFeedbackForm } from "./context";

export function FeedbackFormTitleField() {
  const { actions } = useFeedbackForm();

  return (
    <Input
      maxLength={WIDGET_TITLE_MAX_LENGTH}
      name="title"
      onInput={(event) => actions.setTitle(event.currentTarget.value)}
      placeholder="Share your product feedback!"
      required
    />
  );
}
