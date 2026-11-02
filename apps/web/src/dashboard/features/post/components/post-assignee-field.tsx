import { usePostCollectionData } from "@feeblo/post-ui/post-page-context";
import { Button } from "@feeblo/ui/button";
import {
  Menu,
  MenuCheckboxItem,
  MenuGroup,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
} from "@feeblo/ui/menu";
import { toastManager } from "@feeblo/ui/toast";
import { UserAvatar } from "@feeblo/ui/user-avatar";
import { cn } from "@feeblo/ui/utils";
import { trackEvent } from "@feeblo/web-shared/analytics-provider";
import { hasPermission, usePolicy } from "@feeblo/web-shared/use-policy";
import { UserCircleIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { createOptimisticAction } from "@tanstack/react-db";

import { useCurrentMemberId } from "~/hooks/use-current-member-id";
import { useOrgMembers } from "~/hooks/use-org-members";
import { fetchRpc } from "~/lib/runtime";
import { useDashboardCollections } from "~/providers/dashboard-collections-provider";

/**
 * The post's assignee, editable from the detail sidebar.
 *
 * Assignment is a triage property with its own permission — `posts.status`,
 * the same grant the ETA and status fields use — so this field self-gates
 * exactly like `PostEtaField` instead of trusting the page to hide it. The
 * backend re-checks through `PostPolicy.canUpdateAssignee`.
 */
export function PostAssigneeField({
  disabled = false,
}: {
  disabled?: boolean;
}) {
  const { post, isLocked, isMerged, organizationId } = usePostCollectionData();
  const { postCollection, postActivityCollection } = useDashboardCollections();
  const { data: organizationMembers } = useOrgMembers(organizationId);
  const currentMemberId = useCurrentMemberId(organizationId);
  const { allowed: canAssign } = usePolicy(
    hasPermission(organizationId, "posts.status")
  );

  const members = organizationMembers ?? [];
  const assignee = members.find(
    (member) => member.id === post.assigneeMemberId
  );
  const isDisabled = disabled || isLocked || isMerged || !canAssign;
  const assigneeLabel = assignee
    ? assignee.user.name || assignee.user.email
    : "Assign";

  const updatePostAssignee = createOptimisticAction<{
    assigneeMemberId: string | null;
  }>({
    onMutate: ({ assigneeMemberId }) => {
      postCollection.update(post.id, (draft) => {
        draft.assigneeMemberId = assigneeMemberId;
      });
    },
    mutationFn: async ({ assigneeMemberId }) => {
      await fetchRpc((rpc) =>
        rpc.UpdatePostAssignee({
          id: post.id,
          organizationId,
          assigneeMemberId,
        })
      );

      // The post row is the mutation target and is reconciled optimistically;
      // the ASSIGNEE_CHANGED timeline entry is derived from it, so it refreshes
      // detached.
      await postCollection.utils.refetch();
      await postActivityCollection.utils.refetch();
    },
  });

  const assign = async (assigneeMemberId: string | null) => {
    if (isDisabled || assigneeMemberId === post.assigneeMemberId) {
      return;
    }

    try {
      const transaction = updatePostAssignee({ assigneeMemberId });
      await transaction.when("settled");
      trackEvent("post_updated", { field: "assignee", success: true });
      toastManager.add({
        title: assigneeMemberId ? "Assignee updated" : "Post unassigned",
        type: "success",
      });
    } catch {
      trackEvent("post_updated", { field: "assignee", success: false });
      toastManager.add({
        title: "Failed to update assignee",
        type: "error",
      });
    }
  };

  return (
    <Menu>
      <MenuTrigger
        render={
          <Button
            aria-label={`Assignee: ${assigneeLabel}`}
            className="w-full justify-start"
            disabled={isDisabled}
            size="sm"
            variant="outline"
          />
        }
      >
        {assignee ? (
          <UserAvatar
            className="size-4"
            image={assignee.user.image}
            name={assigneeLabel}
            size="sm"
          />
        ) : (
          <HugeiconsIcon
            className="text-muted-foreground"
            icon={UserCircleIcon}
            strokeWidth={2}
          />
        )}
        <span className={cn("truncate", !assignee && "text-muted-foreground")}>
          {assignee ? assigneeLabel : "Assign"}
        </span>
        {assignee?.id === currentMemberId ? (
          <span className="text-muted-foreground text-xs">(you)</span>
        ) : null}
      </MenuTrigger>
      <MenuPopup align="end" className="w-64" side="bottom">
        <MenuGroup>
          <MenuCheckboxItem
            checked={post.assigneeMemberId === null}
            onCheckedChange={() => {
              void assign(null);
            }}
          >
            Unassigned
          </MenuCheckboxItem>
        </MenuGroup>
        <MenuSeparator />
        <MenuGroup>
          {members.length === 0 ? (
            <MenuItem disabled>No members found</MenuItem>
          ) : (
            members.map((member) => (
              <MenuCheckboxItem
                checked={member.id === post.assigneeMemberId}
                key={member.id}
                onCheckedChange={() => {
                  void assign(member.id);
                }}
              >
                <UserAvatar
                  className="size-4"
                  image={member.user.image}
                  name={member.user.name || member.user.email}
                  size="sm"
                />
                <span className="truncate">
                  {member.user.name || member.user.email}
                </span>
                {member.id === currentMemberId ? (
                  <span className="text-muted-foreground text-xs">(you)</span>
                ) : null}
              </MenuCheckboxItem>
            ))
          )}
        </MenuGroup>
      </MenuPopup>
    </Menu>
  );
}
