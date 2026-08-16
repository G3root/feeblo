import { Button } from "@feeblo/ui/button";
import { ChatFeedback01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useHome } from "../home-context";

export function HomeGiveFeedbackButton() {
  const { actions } = useHome();

  return (
    <Button
      className="shrink-0 px-2.5 sm:px-[calc(--spacing(3)-1px)]"
      onClick={actions.openGiveFeedback}
      variant="brand"
    >
      <HugeiconsIcon icon={ChatFeedback01Icon} />
      <span className="hidden sm:inline">Give Feedback</span>
    </Button>
  );
}
