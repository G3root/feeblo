import { useNavigate } from "@solidjs/router";
import { IconPlaceholder } from "../ui/icon-placeholder";
import { buttonVariants } from "../ui/button";

export function FeedbackSuccess() {
  const navigate = useNavigate();
  return (
    <div class="flex h-full flex-col p-6">
      <div class="flex flex-1 flex-col items-center justify-center text-center">
        <div class="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <IconPlaceholder class="size-6" />
        </div>
        <p class="mt-4 font-medium text-foreground text-lg">
          Thanks for your feedback
        </p>
        <p class="mt-1 max-w-xs text-muted-foreground text-sm">
          Your post has been shared with the team. We will get back to you soon.
        </p>
      </div>
      <div class="mt-4 flex justify-center">
        <button
          class={buttonVariants({ variant: "outline", size: "default" })}
          onClick={() => navigate("/")}
          type="button"
        >
          Back to boards
        </button>
      </div>
    </div>
  );
}
