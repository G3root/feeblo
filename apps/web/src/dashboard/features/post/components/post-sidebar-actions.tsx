import { useBanAuthorDialogContext } from "@feeblo/post-ui/dialog-stores";
import { usePostCollectionData } from "@feeblo/post-ui/post-page-context";
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
import { CopyButton } from "@feeblo/ui/copy-button";
import { toastManager } from "@feeblo/ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@feeblo/ui/tooltip";
import { trackEvent } from "@feeblo/web-shared/analytics-provider";
import {
  refetchInBackground,
  settleOptimisticMutation,
} from "@feeblo/web-shared/collections";
import { parseRpcError } from "@feeblo/web-shared/rpc-error";
import {
  CircleLockIcon,
  CircleUnlockIcon,
  LinkSquare02Icon,
  Trash2,
  UserBlock01Icon,
  UserUnlock01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { createOptimisticAction } from "@tanstack/react-db";
import { memo, useState } from "react";

import { usePostDeleteDialogContext } from "~/features/post/dialog-stores";
import { usePublicSiteUrl } from "~/hooks/use-site";
import { fetchRpc } from "~/lib/runtime";
import { useDashboardCollections } from "~/providers/dashboard-collections-provider";

import { PostMergeMenu } from "./post-merge-menu";

type DialogAction = "lock" | null;
type PostAdminAction = "lock";

export function PostSidebarActions() {
  return (
    <div className="flex items-center justify-end gap-2">
      <PostPublicActionButtons />
      <PostAdminActionButtons />
    </div>
  );
}

const PostPublicActionButtons = memo(function PostPublicActionButtons() {
  return (
    <>
      <RedirectToPostUrlButton />
      <CopyPostButton />
    </>
  );
});

function PostAdminActionButtons() {
  const {
    post,
    board,
    canBanAuthors,
    canDeletePost,
    canModeratePost,
    isLocked,
    isMerged,
    organizationId,
    userBanActions,
  } = usePostCollectionData();
  const { commentCollection, postActivityCollection, postCollection } =
    useDashboardCollections();
  const postDialogStore = usePostDeleteDialogContext();
  const banDialogStore = useBanAuthorDialogContext();
  const [dialogAction, setDialogAction] = useState<DialogAction>(null);
  const [isUnbanning, setIsUnbanning] = useState(false);

  const lockLabel = isLocked ? "Unlock post" : "Lock post";

  const updatePostAdminState = createOptimisticAction<{
    locked: boolean;
  }>({
    onMutate: ({ locked }) => {
      postCollection.update(post.id, (draft) => {
        draft.lockedAt = locked ? new Date() : null;
      });
    },
    mutationFn: async ({ locked }) => {
      await fetchRpc((rpc) =>
        rpc.AdminUpdatePost({
          id: post.id,
          organizationId,
          locked,
        })
      );

      // The post row is the mutation target (already reconciled
      // optimistically); the lock/unlock activity entry is derived, so it
      // refreshes detached.
      await postCollection.utils.refetch();
      refetchInBackground(postActivityCollection.utils.refetch());
    },
  });

  const handleAction = (action: PostAdminAction) => {
    const nextLocked = action === "lock" ? !isLocked : isLocked;

    // The lock flag flips optimistically; close the confirm in the same tick
    // and settle persistence in the background.
    setDialogAction(null);
    settleOptimisticMutation(
      () => updatePostAdminState({ locked: nextLocked }),
      () => {
        trackEvent("post_lock_changed", { locked: nextLocked, success: true });
        toastManager.add({
          title: isLocked ? "Post unlocked" : "Post locked",
          type: "success",
        });
      },
      () => {
        trackEvent("post_lock_changed", { locked: nextLocked, success: false });
        toastManager.add({
          title: "Failed to update lock status",
          type: "error",
        });
      }
    );
  };

  const unbanAuthor = async () => {
    if (userBanActions === undefined) {
      return;
    }
    setIsUnbanning(true);
    try {
      await userBanActions.unban({
        target: { _tag: "post", postId: post.id },
      });
      toastManager.add({
        title: `Unbanned ${post.user.name ?? "this author"}`,
        type: "success",
      });
      // The badge on this page and every comment badge derive from these rows.
      await postCollection.utils.refetch();
      await commentCollection.utils.refetch();
    } catch (error) {
      toastManager.add({
        title: parseRpcError(error).message,
        type: "error",
      });
    } finally {
      setIsUnbanning(false);
    }
  };

  const banAuthorButton = (
    <Tooltip>
      <TooltipTrigger
        render={(props) => (
          <Button
            {...props}
            aria-label="Ban author"
            className="rounded-full"
            onClick={() =>
              banDialogStore.send({
                type: "toggle",
                data: {
                  authorName: post.user.name ?? "this user",
                  target: { _tag: "post", postId: post.id },
                },
              })
            }
            size="icon-sm"
            variant="outline"
          >
            <HugeiconsIcon icon={UserBlock01Icon} />
          </Button>
        )}
      />
      <TooltipPopup>Ban author</TooltipPopup>
    </Tooltip>
  );

  const unbanAuthorButton = (
    <Tooltip>
      <TooltipTrigger
        render={(props) => (
          <Button
            {...props}
            aria-label="Unban author"
            className="rounded-full"
            disabled={isUnbanning}
            onClick={() => {
              void unbanAuthor();
            }}
            size="icon-sm"
            variant="outline"
          >
            <HugeiconsIcon icon={UserUnlock01Icon} />
          </Button>
        )}
      />
      <TooltipPopup>Unban author</TooltipPopup>
    </Tooltip>
  );

  return (
    <>
      <PostMergeMenu />

      <Tooltip>
        <TooltipTrigger
          render={(props) => (
            <Button
              {...props}
              aria-label={lockLabel}
              className="rounded-full"
              disabled={!canModeratePost || isMerged}
              onClick={() => setDialogAction("lock")}
              size="icon-sm"
              variant="outline"
            >
              <HugeiconsIcon
                icon={isLocked ? CircleUnlockIcon : CircleLockIcon}
              />
            </Button>
          )}
        />
        <TooltipPopup>{lockLabel}</TooltipPopup>
      </Tooltip>

      {canBanAuthors && !post.authorIsMember && post.creatorId
        ? post.authorIsBanned === true
          ? unbanAuthorButton
          : banAuthorButton
        : null}

      <Tooltip>
        <TooltipTrigger
          render={(props) => (
            <Button
              {...props}
              aria-label="Delete post"
              className="rounded-full"
              // A merged post is read-only until unmerged; delete goes through
              // the unmerge path (or the survivor's delete, which reverts the
              // merge first).
              disabled={!canDeletePost || isMerged}
              onClick={() =>
                postDialogStore.send({
                  type: "toggle",
                  data: {
                    postId: post.id,
                    redirectOptions: {
                      to: "/$organizationId/board/$boardSlug",
                      params: {
                        organizationId,
                        boardSlug: board.slug,
                      },
                    },
                  },
                })
              }
              size="icon-sm"
              variant="outline"
            >
              <HugeiconsIcon icon={Trash2} />
            </Button>
          )}
        />
        <TooltipPopup>Delete post</TooltipPopup>
      </Tooltip>

      <ConfirmActionDialog
        description={
          isLocked
            ? "This will allow members to interact with the post again."
            : "This will prevent further interaction until the post is unlocked."
        }
        isOpen={dialogAction === "lock"}
        onConfirm={() => handleAction("lock")}
        onOpenChange={(open) => setDialogAction(open ? "lock" : null)}
        title={isLocked ? "Unlock Post" : "Lock Post"}
      />
    </>
  );
}

function ConfirmActionDialog({
  description,
  isOpen,
  onConfirm,
  onOpenChange,
  title,
}: {
  description: string;
  isOpen: boolean;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
  title: string;
}) {
  return (
    <AlertDialog onOpenChange={onOpenChange} open={isOpen}>
      <AlertDialogPopup>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <Button onClick={onConfirm}>Continue</Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}

function RedirectToPostUrlButton() {
  const { post } = usePostCollectionData();
  const publicSiteUrl = usePublicSiteUrl();

  if (!publicSiteUrl) {
    return null;
  }

  return (
    <Tooltip>
      <TooltipTrigger
        render={(props) => (
          <Button
            {...props}
            className="rounded-full"
            render={(buttonProps) => (
              <a
                {...buttonProps}
                href={`${publicSiteUrl}/p/${post.slug}`}
                rel="noopener noreferrer"
                target="_blank"
              >
                <HugeiconsIcon icon={LinkSquare02Icon} />
              </a>
            )}
            size="icon-sm"
            variant="outline"
          />
        )}
      />
      <TooltipPopup>Go to Public Post</TooltipPopup>
    </Tooltip>
  );
}

function CopyPostButton() {
  const { post } = usePostCollectionData();
  const publicSiteUrl = usePublicSiteUrl();

  if (!publicSiteUrl) {
    return null;
  }

  return (
    <CopyButton
      aria-label="Copy post link"
      onCopy={() => `${publicSiteUrl}/p/${post.slug}`}
      size="icon-sm"
      successMessage="Post URL copied!"
      tooltipPopup="Copy post link"
      variant="outline"
    />
  );
}
