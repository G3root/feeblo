import { Sent02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useNavigate } from "@tanstack/react-router";

import { Button } from "../ui/button";

export function FeedbackSuccess() {
  const navigate = useNavigate();
  return (
    <div className="flex h-full flex-col p-6">
      <div className="flex flex-1 flex-col items-center justify-center text-center">
        <div className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <HugeiconsIcon className="size-6" icon={Sent02Icon} />
        </div>
        <p className="mt-4 font-medium text-foreground text-lg">
          Thanks for your feedback
        </p>
        <p className="mt-1 max-w-xs text-muted-foreground text-sm">
          Your post has been shared with the team. We will get back to you soon.
        </p>
      </div>
      <div className="mt-4 flex justify-center">
        <Button onClick={() => navigate({ to: "/" })} variant="outline">
          Back to boards
        </Button>
      </div>
    </div>
  );
}
