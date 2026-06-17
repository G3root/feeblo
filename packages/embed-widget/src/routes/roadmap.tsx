import { MapPinIcon } from "@hugeicons/core-free-icons";
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

export const roadmapRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/roadmap",
  component: RoadmapComponent,
});

function RoadmapComponent() {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <Empty className="max-w-sm border p-8">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <HugeiconsIcon icon={MapPinIcon} />
          </EmptyMedia>
          <EmptyTitle>Roadmap is empty</EmptyTitle>
          <EmptyDescription>
            Check back soon for upcoming plans
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    </div>
  );
}
