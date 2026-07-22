import { usePostCollectionData } from "@feeblo/post-ui/post-page-context";
import { StatusField } from "@feeblo/post-ui/post-properties";
import { toastManager } from "@feeblo/ui/toast";
import { eq, useLiveQuery } from "@tanstack/react-db";
import { useDashboardCollections } from "~/providers/dashboard-collections-provider";

export function PostStatusSelect({ disabled = false }: { disabled?: boolean }) {
  const { post, organizationId, isLocked, canManagePost } =
    usePostCollectionData();
  const isDisabled = disabled || isLocked || !canManagePost;
  const { postCollection, postStatusCollection } = useDashboardCollections();

  const { data: postStatuses } = useLiveQuery(
    (q) =>
      q
        .from({ postStatus: postStatusCollection })
        .where(({ postStatus }) =>
          eq(postStatus.organizationId, organizationId)
        ),
    [organizationId]
  );

  if (!postStatuses) {
    return null;
  }

  return (
    <StatusField
      currentStatusId={post.statusId}
      disabled={isDisabled}
      onValueChange={async (nextPostStatus) => {
        if (!nextPostStatus || isDisabled) {
          return;
        }
        try {
          const tx = postCollection.update(post.id, (draft) => {
            draft.statusId = nextPostStatus.id;
          });
          await tx.isPersisted.promise;

          toastManager.add({
            title: "Status updated",
            type: "success",
          });
        } catch {
          toastManager.add({
            title: "Failed to update status",
            type: "error",
          });
        }
      }}
      statuses={postStatuses}
    />
  );
}
