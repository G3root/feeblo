import { BookOpen01Icon } from "@hugeicons/core-free-icons";
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

export const updatesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/updates",
  component: UpdatesComponent,
});

function UpdatesComponent() {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <Empty className="max-w-sm border p-8">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <HugeiconsIcon icon={BookOpen01Icon} />
          </EmptyMedia>
          <EmptyTitle>No updates published yet</EmptyTitle>
          <EmptyDescription>
            The team will share news and releases here
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    </div>
  );
}
