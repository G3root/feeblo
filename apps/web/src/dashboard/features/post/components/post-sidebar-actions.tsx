import { usePostCollectionData } from "@feeblo/post-ui/post-page-context";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogPopup,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@feeblo/ui/alert-dialog";
import { Button } from "@feeblo/ui/button";
import { toastManager } from "@feeblo/ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@feeblo/ui/tooltip";
import {
  CircleLockIcon,
  CircleUnlockIcon,
  Copy01Icon,
  LinkSquare02Icon,
  Trash2,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { createOptimisticAction } from "@tanstack/react-db";
import { memo, useState } from "react";
import { usePostDeleteDialogContext } from "~/features/post/dialog-stores";
import { getPublicSiteUrl } from "~/hooks/use-site";
import { fetchRpc } from "~/lib/runtime";
import { useDashboardCollections } from "~/providers/dashboard-collections-provider";

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
  const { post, board, canManagePost, isLocked, organizationId } =
    usePostCollectionData();
  const { postCollection } = useDashboardCollections();
  const postDialogStore = usePostDeleteDialogContext();
  const [dialogAction, setDialogAction] = useState<DialogAction>(null);
  const [pendingAction, setPendingAction] = useState<PostAdminAction | null>(
    null
  );

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
        rpc.PostAdminUpdate({
          id: post.id,
          organizationId,
          locked,
        })
      );

      await postCollection.utils.refetch();
    },
  });

  const handleAction = async (action: PostAdminAction) => {
    setPendingAction(action);

    try {
      const nextLocked = action === "lock" ? !isLocked : isLocked;

      await updatePostAdminState({
        locked: nextLocked,
      });

      toastManager.add({
        title: isLocked ? "Post unlocked" : "Post locked",
        type: "success",
      });

      setDialogAction(null);
    } catch (_error) {
      toastManager.add({
        title: "Failed to update lock status",
        type: "error",
      });
    } finally {
      setPendingAction(null);
    }
  };

  return (
    <>
      {canManagePost ? (
        <>
          <Tooltip>
            <TooltipTrigger
              render={(props) => (
                <Button
                  {...props}
                  aria-label={lockLabel}
                  className="rounded-full"
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

          <Tooltip>
            <TooltipTrigger
              render={(props) => (
                <Button
                  {...props}
                  aria-label="Delete post"
                  className="rounded-full"
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
        </>
      ) : null}

      <ConfirmActionDialog
        description={
          isLocked
            ? "This will allow members to interact with the post again."
            : "This will prevent further interaction until the post is unlocked."
        }
        isOpen={dialogAction === "lock"}
        isPending={pendingAction === "lock"}
        onConfirm={() => void handleAction("lock")}
        onOpenChange={(open) => setDialogAction(open ? "lock" : null)}
        title={isLocked ? "Unlock Post" : "Lock Post"}
      />
    </>
  );
}

function ConfirmActionDialog({
  description,
  isOpen,
  isPending,
  onConfirm,
  onOpenChange,
  title,
}: {
  description: string;
  isOpen: boolean;
  isPending: boolean;
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
          <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
          <AlertDialogAction disabled={isPending} onClick={onConfirm}>
            {isPending ? "Updating..." : "Continue"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}

function RedirectToPostUrlButton() {
  const { post } = usePostCollectionData();
  const publicSiteUrl = getPublicSiteUrl();

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
  const publicSiteUrl = getPublicSiteUrl();

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
            onClick={() => {
              try {
                navigator.clipboard.writeText(
                  `${publicSiteUrl}/p/${post.slug}`
                );
                toastManager.add({
                  title: "Post URL copied to clipboard",
                  type: "success",
                });
              } catch (_error) {
                toastManager.add({
                  title: "Failed to copy post URL to clipboard",
                  type: "error",
                });
              }
            }}
            size="icon-sm"
            variant="outline"
          >
            <HugeiconsIcon icon={Copy01Icon} />
          </Button>
        )}
      />
      <TooltipPopup>Copy post link</TooltipPopup>
    </Tooltip>
  );
}
