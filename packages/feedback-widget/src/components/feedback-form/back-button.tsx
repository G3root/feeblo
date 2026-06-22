import { useNavigate } from "@solidjs/router";
import { buttonVariants } from "../ui/button";
import { IconPlaceholder } from "../ui/icon-placeholder";

export function FeedbackFormBackButton() {
  const navigate = useNavigate();
  return (
    <button
      aria-label="Back"
      class={buttonVariants({ variant: "ghost", size: "icon-sm" })}
      onClick={() => navigate("/")}
      type="button"
    >
      <IconPlaceholder class="size-5" />
    </button>
  );
}
