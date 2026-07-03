import { StatusField } from "@feeblo/post-ui/post-properties";
import { toastManager } from "@feeblo/ui/toast";
import { eq, useLiveQuery } from "@tanstack/react-db";
import { useOrganizationId } from "~/hooks/use-organization-id";
import { useDashboardCollections } from "~/providers/dashboard-collections-provider";

interface PostStatusSelectProps {
  currentStatusId: string;
  disabled?: boolean;
  postId: string;
}

export function PostStatusSelect({
  currentStatusId,
  disabled,
  postId,
}: PostStatusSelectProps) {
  const organizationId = useOrganizationId();
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
      currentStatusId={currentStatusId}
      disabled={disabled}
      onValueChange={async (nextPostStatus) => {
        if (!nextPostStatus || disabled) {
          return;
        }
        try {
          const tx = postCollection.update(postId, (draft) => {
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
