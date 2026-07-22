import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "@feeblo/ui/alert-dialog";
import { toastManager } from "@feeblo/ui/toast";
import { useSelector } from "@xstate/store-react";
import { useDashboardCollections } from "~/providers/dashboard-collections-provider";
import {
  type CustomAttributeEntityType,
  useCustomAttributeDeleteDialogContext,
} from "../dialog-stores";

function getCollection(
  entityType: CustomAttributeEntityType,
  collections: ReturnType<typeof useDashboardCollections>
) {
  return entityType === "contact"
    ? collections.contactAttributeDefinitionCollection
    : collections.companyAttributeDefinitionCollection;
}

export function CustomAttributeDeleteDialog() {
  const store = useCustomAttributeDeleteDialogContext();
  const collections = useDashboardCollections();
  const open = useSelector(store, (state) => state.context.open);
  const entityType = useSelector(
    store,
    (state) => state.context.data.entityType
  );

  return (
    <AlertDialog
      onOpenChange={() => store.send({ type: "toggle" })}
      open={open}
    >
      <AlertDialogPopup>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete Attribute</AlertDialogTitle>
          <AlertDialogDescription>
            This action cannot be undone. This will permanently delete the
            custom attribute.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={async () => {
              try {
                const { attributeId } = store.get().context.data;
                const collection = getCollection(entityType, collections);
                const tx = collection.delete(attributeId);
                await tx.isPersisted.promise;
                toastManager.add({
                  title: "Attribute deleted successfully",
                  type: "success",
                });
              } catch (_error) {
                toastManager.add({
                  title: "Failed to delete attribute",
                  type: "error",
                });
              }
            }}
          >
            Continue
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}
