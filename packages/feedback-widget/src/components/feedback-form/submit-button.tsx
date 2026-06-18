import { Sent02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Button } from "../ui/button";
import { useFeedbackForm } from "./context";

export function FeedbackFormSubmitButton() {
  const {
    meta: { canSubmit },
    actions: { submit },
  } = useFeedbackForm();
  return (
    <Button disabled={!canSubmit} onClick={submit}>
      <HugeiconsIcon className="-mt-1 size-4 -rotate-45" icon={Sent02Icon} />
      Create a new post
    </Button>
  );
}
