import { useNavigate } from "@solidjs/router";
import { IconPlaceholder } from "../ui/icon-placeholder";
import { buttonVariants } from "../ui/button";

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
