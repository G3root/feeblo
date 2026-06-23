import { useNavigate } from "@solidjs/router";
import { Button } from "../ui/button";
import { Icon } from "../ui/icon";

export function FeedbackSuccess() {
  const navigate = useNavigate();
  return (
    <div class="flex h-full flex-col p-6">
      <div class="flex flex-1 flex-col items-center justify-center text-center">
        <div class="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <Icon class="size-6" name="CheckIcon" />
        </div>
        <p class="mt-4 font-medium text-foreground text-lg">
          Thanks for your feedback
        </p>
        <p class="mt-1 max-w-xs text-muted-foreground text-sm">
          Your post has been shared with the team. We will get back to you soon.
        </p>
      </div>
      <div class="mt-4 flex justify-center">
        <Button onClick={() => navigate("/")} type="button" variant="outline">
          Back to boards
        </Button>
      </div>
    </div>
  );
}
