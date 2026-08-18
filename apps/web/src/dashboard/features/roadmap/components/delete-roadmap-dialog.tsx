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
import { eq, useLiveQuery } from "@tanstack/react-db";
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

  const { data: roadmaps, isLoading } = useLiveQuery(
    (q) =>
      q
        .from({ roadmap: roadmapCollection })
        .where(({ roadmap }) => eq(roadmap.organizationId, organizationId))
        .orderBy(({ roadmap }) => roadmap.createdAt, "asc"),
    [organizationId]
  );

  const handleDelete = async () => {
    const id = store.get().context.data.roadmapId;
    const deletedRoadmap = isLoading ? undefined : roadmapCollection.get(id);

    try {
      const tx = roadmapCollection.delete(id);
      await tx.isPersisted.promise;
    } catch (_error) {
      toastManager.add({
        title: "Failed to delete roadmap",
        type: "error",
      });
      return;
    }

    if (!isLoading && deletedRoadmap?.isPrimary) {
      try {
        const nextRoadmap = (roadmaps ?? []).find(
          (roadmap) => roadmap.id !== id
        );

        if (nextRoadmap) {
          const primaryTx = roadmapCollection.update(
            nextRoadmap.id,
            (draft) => {
              draft.isPrimary = true;
              draft.updatedAt = new Date();
            }
          );
          await primaryTx.isPersisted.promise;
        }
      } catch (_error) {
        toastManager.add({
          title: "Failed to promote a replacement primary roadmap",
          type: "error",
        });
      }
    }

    store.send({ type: "toggle" });
    toastManager.add({
      title: "Roadmap deleted successfully",
      type: "success",
    });

    await navigate({
      to: "/$organizationId/roadmap",
      params: { organizationId },
    });
  };

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
          <Button onClick={handleDelete} variant="destructive">
            Continue
          </Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}
