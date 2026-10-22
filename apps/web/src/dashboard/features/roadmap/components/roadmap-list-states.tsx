import { Button } from "@feeblo/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@feeblo/ui/empty";
import { hasPermission, PolicyGuard } from "@feeblo/web-shared/use-policy";
import { LayoutThreeColumnIcon, Plus } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { useCreateRoadmapDialogContext } from "~/features/roadmap/dialog-stores";
import { useOrganizationId } from "~/hooks/use-organization-id";

// ---------------------------------------------------------------------------
// Explicit empty variants — children over render props
// ---------------------------------------------------------------------------

function RoadmapCreateButton() {
  const organizationId = useOrganizationId();
  const createStore = useCreateRoadmapDialogContext();
  return (
    <PolicyGuard policy={hasPermission(organizationId, "roadmap.*")}>
      {({ allowed }) => (
        <Button
          disabled={!allowed}
          onClick={() => createStore.send({ type: "toggle" })}
          type="button"
          variant="brand"
        >
          <HugeiconsIcon icon={Plus} />
          Create roadmap
        </Button>
      )}
    </PolicyGuard>
  );
}

export function RoadmapEmptyState() {
  return (
    <div className="p-3">
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <HugeiconsIcon icon={LayoutThreeColumnIcon} />
          </EmptyMedia>
          <EmptyTitle>No roadmaps yet</EmptyTitle>
          <EmptyDescription>
            Create a roadmap to visualize how feedback moves from idea to
            shipped.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <RoadmapCreateButton />
        </EmptyContent>
      </Empty>
    </div>
  );
}
