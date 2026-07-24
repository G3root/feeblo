import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "@feeblo/ui/alert-dialog";
import { Button } from "@feeblo/ui/button";
import { toastManager } from "@feeblo/ui/toast";
import { useNavigate } from "@tanstack/react-router";
import { useSelector } from "@xstate/store-react";
import { useOrganizationId } from "~/hooks/use-organization-id";
import { roadmapCollection } from "~/lib/collections";
import { useDeleteRoadmapDialogContext } from "../dialog-stores";

export function DeleteRoadmapDialog() {
  const store = useDeleteRoadmapDialogContext();
  const open = useSelector(store, (state) => state.context.open);
  const navigate = useNavigate();
  const organizationId = useOrganizationId();

  return (
    <AlertDialog
      onOpenChange={() => store.send({ type: "toggle" })}
      open={open}
    >
      <AlertDialogPopup>
        <AlertDialogHeader>
          <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
          <AlertDialogDescription>
            This action cannot be undone. This will permanently delete the
            roadmap and all associated data.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <Button
            onClick={async () => {
              try {
                const id = store.get().context.data.roadmapId;

                const tx = roadmapCollection.delete(id);
                await tx.isPersisted.promise;
                store.send({ type: "toggle" });
                toastManager.add({
                  title: "Roadmap deleted successfully",
                  type: "success",
                });

                await navigate({
                  to: "/$organizationId/roadmap",
                  params: { organizationId },
                });
              } catch (_error) {
                toastManager.add({
                  title: "Failed to delete roadmap",
                  type: "error",
                });
              }
            }}
            variant="destructive"
          >
            Continue
          </Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}
