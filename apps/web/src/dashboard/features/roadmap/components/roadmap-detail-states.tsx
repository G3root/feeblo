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
