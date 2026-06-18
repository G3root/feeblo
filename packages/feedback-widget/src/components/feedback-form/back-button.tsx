import { ArrowLeft01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useNavigate } from "@tanstack/react-router";

import { Button } from "../ui/button";

export function FeedbackFormBackButton() {
  const navigate = useNavigate();
  return (
    <Button
      aria-label="Back"
      onClick={() => navigate({ to: "/" })}
      size="icon-sm"
      variant="ghost"
    >
      <HugeiconsIcon className="size-5" icon={ArrowLeft01Icon} />
    </Button>
  );
}
