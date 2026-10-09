import { ConfirmDialog } from "@feeblo/ui/confirm-dialog";
import { toastManager } from "@feeblo/ui/toast";
import { settleOptimisticMutation } from "@feeblo/web-shared/collections";
import { useNavigate } from "@tanstack/react-router";
import { useSelector } from "@xstate/store-react";

import { useOrganizationId } from "~/hooks/use-organization-id";
import { dashboardCollections } from "~/lib/collections";

import { useDeleteRoadmapDialogContext } from "../dialog-stores";

export function DeleteRoadmapDialog() {
  const store = useDeleteRoadmapDialogContext();
  const open = useSelector(store, (state) => state.context.open);
  const navigate = useNavigate();
  const organizationId = useOrganizationId();

  return (
    <ConfirmDialog
      description="This action cannot be undone. This will permanently delete the roadmap and all associated data."
      onConfirm={() => {
        const id = store.get().context.data.roadmapId;

        // The row is removed optimistically; close and navigate now so a slow
        // network never holds the confirm open. `RoadmapDelete` promotes a
        // successor atomically server-side, and the collection read-back picks
        // up the new primary — the client must not promote one itself.
        store.send({ type: "setOpen", open: false });
        void navigate({
          to: "/$organizationId/roadmap",
          params: { organizationId },
        });

        settleOptimisticMutation(
          () => dashboardCollections.roadmapCollection.delete(id),
          () => {
            toastManager.add({
              title: "Roadmap deleted successfully",
              type: "success",
            });
          },
          () => {
            toastManager.add({
              title: "Failed to delete roadmap",
              type: "error",
            });
          }
        );
      }}
      onOpenChange={(open) => store.send({ type: "setOpen", open })}
      open={open}
      title="Are you absolutely sure?"
    />
  );
}
