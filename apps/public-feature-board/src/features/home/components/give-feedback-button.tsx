import { Button } from "@feeblo/ui/button";
import { FloatingActionButton } from "@feeblo/ui/floating-action-button";
import { ChatFeedback01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { m } from "../../../paraglide/messages.js";
import { useHome } from "../home-context";

export function HomeGiveFeedbackButton() {
  const { actions } = useHome();

  return (
    <>
      <Button
        className="shrink-0 max-md:hidden"
        onClick={actions.openGiveFeedback}
        variant="brand"
      >
        <HugeiconsIcon icon={ChatFeedback01Icon} />
        {m.proud_honest_flamingo()}
      </Button>
      <FloatingActionButton
        icon={<HugeiconsIcon icon={ChatFeedback01Icon} />}
        onClick={actions.openGiveFeedback}
      >
        {m.proud_honest_flamingo()}
      </FloatingActionButton>
    </>
  );
}
