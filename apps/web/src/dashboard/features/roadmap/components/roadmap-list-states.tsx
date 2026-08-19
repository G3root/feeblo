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
// Compound header — replaces boolean prop `showCreateAction`
// Prefer explicit composition over `showCreateAction` boolean.
// ---------------------------------------------------------------------------

function RoadmapListHeaderRoot({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between px-3">{children}</div>
  );
}

function RoadmapListHeaderTitle({ children }: { children: React.ReactNode }) {
  return <h1 className="text-xl font-semibold">{children}</h1>;
}

function RoadmapListHeaderActions({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center gap-2">{children}</div>;
}

export const RoadmapListHeaderCompound = {
  Actions: RoadmapListHeaderActions,
  Root: RoadmapListHeaderRoot,
  Title: RoadmapListHeaderTitle,
};

// Explicit variants — self-documenting, no hidden conditionals
export function RoadmapIndexHeader() {
  const organizationId = useOrganizationId();
  const createStore = useCreateRoadmapDialogContext();
  return (
    <RoadmapListHeaderRoot>
      <RoadmapListHeaderTitle>Roadmaps</RoadmapListHeaderTitle>
      <RoadmapListHeaderActions>
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
      </RoadmapListHeaderActions>
    </RoadmapListHeaderRoot>
  );
}

export function RoadmapEmptyHeader() {
  return (
    <RoadmapListHeaderRoot>
      <RoadmapListHeaderTitle>Roadmaps</RoadmapListHeaderTitle>
    </RoadmapListHeaderRoot>
  );
}

// Back-compat wrapper — delegates to compound; keeps existing callers working
// TODO: migrate callers to RoadmapListHeaderCompound or explicit variants
export function RoadmapListHeader({
  showCreateAction = true,
}: {
  showCreateAction?: boolean;
}) {
  if (showCreateAction) return <RoadmapIndexHeader />;
  return <RoadmapEmptyHeader />;
}

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

// Re-export compound for consumers that prefer composition
export const RoadmapList = {
  CreateButton: RoadmapCreateButton,
  EmptyHeader: RoadmapEmptyHeader,
  EmptyState: RoadmapEmptyState,
  Header: {
    Actions: RoadmapListHeaderActions,
    Root: RoadmapListHeaderRoot,
    Title: RoadmapListHeaderTitle,
  },
  IndexHeader: RoadmapIndexHeader,
};
