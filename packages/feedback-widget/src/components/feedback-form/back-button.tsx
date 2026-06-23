import { useNavigate } from "@solidjs/router";
import { Button } from "../ui/button";
import { Icon } from "../ui/icon";

export function FeedbackFormBackButton() {
  const navigate = useNavigate();
  return (
    <Button
      aria-label="Back"
      onClick={() => navigate("/")}
      size="icon-lg"
      variant="outline"
    >
      <Icon name="ArrowLeft01Icon" />
    </Button>
  );
}
