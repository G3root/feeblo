import { useNavigate } from "@solidjs/router";

import { Button } from "../ui/button";
import { Icon } from "../ui/icon";

export function FeedbackSuccess() {
  const navigate = useNavigate();
  return (
    <div class="flex h-full flex-col p-6">
      <div class="flex flex-1 flex-col items-center justify-center text-center">
        <div class="bg-muted text-foreground flex size-12 items-center justify-center rounded-full">
          <Icon class="size-6" name="CheckIcon" />
        </div>
        <p class="text-foreground mt-4 text-lg font-medium">
          Thanks for your feedback
        </p>
        <p class="text-muted-foreground mt-1 max-w-xs text-sm">
          Your post has been shared with the team. We will get back to you soon.
        </p>
      </div>
      <div class="mt-4 flex justify-center">
        <Button onClick={() => navigate("/")} type="button" variant="outline">
          <Icon name="ArrowLeft01Icon" /> Back to boards
        </Button>
      </div>
    </div>
  );
}
