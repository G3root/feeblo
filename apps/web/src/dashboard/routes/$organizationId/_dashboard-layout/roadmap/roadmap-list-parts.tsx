import { Button } from "@feeblo/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@feeblo/ui/empty";
import {
  hasOwnerOrAdminRole,
  hasPermission,
  PolicyGuard,
  usePolicy,
} from "@feeblo/web-shared/use-policy";
import { LayoutThreeColumnIcon, Plus } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { useCreateRoadmapDialogContext } from "~/features/roadmap/dialog-stores";
import { useOrganizationId } from "~/hooks/use-organization-id";

export function RoadmapListHeader({
  showCreateAction = true,
}: {
  showCreateAction?: boolean;
}) {
  const organizationId = useOrganizationId();
  const createStore = useCreateRoadmapDialogContext();

  return (
    <div className="flex items-center justify-between px-3">
      <h1 className="text-xl font-semibold">Roadmaps</h1>
      {showCreateAction ? (
        <PolicyGuard policy={hasPermission(organizationId, "roadmap.*")}>
          {({ allowed }) => (
            <Button
              disabled={!allowed}
              onClick={() => createStore.send({ type: "toggle" })}
              size="sm"
            >
              <HugeiconsIcon icon={Plus} />
              New Roadmap
            </Button>
          )}
        </PolicyGuard>
      ) : null}
    </div>
  );
}
export function RoadmapLoadingState() {
  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-6xl flex-col overflow-hidden p-4 md:p-6">
      <div className="grid min-w-max auto-cols-max grid-flow-col gap-4 overflow-x-auto p-3">
        {["planned", "in-progress", "completed"].map((key) => (
          <div className="bg-muted/30 h-96 w-80 rounded-lg" key={key} />
        ))}
      </div>
    </div>
  );
}
export function RoadmapEmptyState() {
  const organizationId = useOrganizationId();
  const createStore = useCreateRoadmapDialogContext();
  const { allowed: canManage } = usePolicy(hasOwnerOrAdminRole(organizationId));

  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <HugeiconsIcon icon={LayoutThreeColumnIcon} />
        </EmptyMedia>
        <EmptyTitle>No roadmaps yet</EmptyTitle>
        <EmptyDescription>
          Create a roadmap to visualize how feedback moves from idea to shipped.
        </EmptyDescription>
      </EmptyHeader>
      {canManage ? (
        <EmptyContent>
          <Button onClick={() => createStore.send({ type: "toggle" })}>
            <HugeiconsIcon icon={Plus} />
            Create roadmap
          </Button>
        </EmptyContent>
      ) : null}
    </Empty>
  );
}
export function RoadmapEmptyMessage({ message }: { message: string }) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyTitle>Nothing here yet</EmptyTitle>
        <EmptyDescription>{message}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
