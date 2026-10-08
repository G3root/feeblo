import { useNavigate } from "@solidjs/router";

import { Button } from "../ui/button";
import { Icon } from "../ui/icon";

export function FeedbackSuccess() {
  const navigate = useNavigate();

  return (
    <div class="widget-enter flex min-h-full flex-col p-6" data-enter="rise">
      <div class="flex flex-1 flex-col items-center justify-center gap-3 text-center">
        <div class="bg-success/8 text-success-foreground widget-pop flex size-12 items-center justify-center rounded-full">
          <Icon class="size-6" name="CheckIcon" />
        </div>
        <div>
          <p class="text-foreground text-lg font-medium">
            Thanks for your feedback
          </p>
          <p class="text-muted-foreground mt-1 max-w-xs text-sm">
            Your post has been shared with the team. We will get back to you
            soon.
          </p>
        </div>
      </div>
      <div class="mt-4 flex justify-center">
        <Button onClick={() => navigate("/")} variant="outline">
          <Icon name="ArrowLeft01Icon" />
          Back to boards
        </Button>
      </div>
    </div>
  );
}
