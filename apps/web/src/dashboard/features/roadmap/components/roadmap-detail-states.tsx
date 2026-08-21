import { Button } from "@feeblo/ui/button";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
} from "@feeblo/ui/menu";
import { hasPermission, PolicyGuard } from "@feeblo/web-shared/use-policy";
import {
  CircleLockIcon,
  CircleUnlockIcon,
  Delete02Icon,
  Edit01Icon,
  MoreHorizontalIcon,
  Plus,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import {
  useCreateRoadmapDialogContext,
  useDeleteRoadmapDialogContext,
  useEditRoadmapDialogContext,
  useToggleRoadmapVisibilityDialogContext,
} from "~/features/roadmap/dialog-stores";
import { useOrganizationId } from "~/hooks/use-organization-id";

export function RoadmapDetailActions({
  roadmapId,
  visibility,
}: {
  roadmapId: string;
  visibility: "public" | "private";
}) {
  const organizationId = useOrganizationId();
  const createStore = useCreateRoadmapDialogContext();
  const deleteStore = useDeleteRoadmapDialogContext();
  const editStore = useEditRoadmapDialogContext();
  const visibilityStore = useToggleRoadmapVisibilityDialogContext();

  const isPrivate = visibility === "private";

  const handleDeleteClick = () => {
    deleteStore.send({ type: "toggle", data: { roadmapId } });
  };

  const handleEditClick = () => {
    editStore.send({ type: "toggle", data: { roadmapId } });
  };

  const handleVisibilityClick = () => {
    visibilityStore.send({
      type: "toggle",
      data: { roadmapId, currentVisibility: visibility },
    });
  };

  return (
    <PolicyGuard policy={hasPermission(organizationId, "roadmap.*")}>
      {({ allowed }) => (
        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          <Menu>
            <MenuTrigger
              render={
                <Button
                  aria-label="Open roadmap actions menu"
                  disabled={!allowed}
                  size="icon-sm"
                  variant="outline"
                >
                  <HugeiconsIcon icon={MoreHorizontalIcon} />
                </Button>
              }
            />
            <MenuPopup align="end" className="w-56">
              <MenuItem disabled={!allowed} onClick={handleVisibilityClick}>
                <HugeiconsIcon
                  icon={isPrivate ? CircleUnlockIcon : CircleLockIcon}
                />
                {isPrivate ? "Make public" : "Make private"}
              </MenuItem>
              <MenuItem disabled={!allowed} onClick={handleEditClick}>
                <HugeiconsIcon icon={Edit01Icon} />
                Edit roadmap
              </MenuItem>
              <MenuSeparator />
              <MenuItem
                disabled={!allowed}
                onClick={handleDeleteClick}
                variant="destructive"
              >
                <HugeiconsIcon icon={Delete02Icon} />
                Delete roadmap
              </MenuItem>
            </MenuPopup>
          </Menu>

          <div
            aria-hidden
            className="bg-border hidden h-6 w-px shrink-0 sm:block"
          />

          <Button
            aria-label="Create new roadmap"
            disabled={!allowed}
            onClick={() => createStore.send({ type: "toggle" })}
            size="sm"
            variant="brand"
          >
            <HugeiconsIcon icon={Plus} />
            <span className="hidden sm:inline">New Roadmap</span>
          </Button>
        </div>
      )}
    </PolicyGuard>
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
export function RoadmapEmptyState({ message }: { message: string }) {
  return (
    <div className="border-border/70 bg-muted/20 text-muted-foreground flex min-h-64 flex-1 items-center justify-center rounded-lg border border-dashed p-6 text-center text-sm">
      {message}
    </div>
  );
}
