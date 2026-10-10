import { WIDGET_TITLE_MAX_LENGTH } from "@feeblo/domain/content-limits";
import { onMount } from "solid-js";

import { Input } from "../ui/input";
import { useFeedbackForm } from "./context";

export function FeedbackFormTitleField() {
  const { actions } = useFeedbackForm();
  let input: HTMLInputElement | undefined;

  // A composer should be ready to type in. The microtask lets this win over
  // the pushed view's container focus without blocking it when this is not
  // the first field the visitor meets.
  onMount(() => {
    queueMicrotask(() => input?.focus({ preventScroll: true }));
  });

  return (
    <Input
      aria-label="Title"
      maxLength={WIDGET_TITLE_MAX_LENGTH}
      name="title"
      onInput={(event) => actions.setTitle(event.currentTarget.value)}
      placeholder="Share your product feedback!"
      ref={input}
      required
      type="text"
    />
  );
}
