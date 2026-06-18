import { ChatFeedback01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { createRoute } from "@tanstack/react-router";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "../components/ui/empty";
import { rootRoute } from "./__root";

export const feedbackRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/feedback",
  component: FeedbackComponent,
});

function FeedbackComponent() {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <Empty className="max-w-sm border p-8">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <HugeiconsIcon icon={ChatFeedback01Icon} />
          </EmptyMedia>
          <EmptyTitle>No feedback yet</EmptyTitle>
          <EmptyDescription>
            Be the first to share your thoughts
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    </div>
  );
}
