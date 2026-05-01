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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import { Button } from "~/components/ui/button";
import { toastManager } from "~/components/ui/toast";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "~/components/ui/tooltip";
import { usePostDeleteDialogContext } from "~/features/post/dialog-stores";
import { getPublicSiteUrl } from "~/hooks/use-site";
import { postCollection } from "~/lib/collections";
import { fetchRpc } from "~/lib/runtime";

type DialogAction = "lock" | null;
type PostAdminAction = "lock";

type PostSidebarActionsProps = {
  boardSlug: string;
  canManagePost: boolean;
  lockedAt: Date | string | null;
  organizationId: string;
  postId: string;
  postSlug: string;
};

export function PostSidebarActions({
  boardSlug,
  canManagePost,
  lockedAt,
  organizationId,
  postId,
  postSlug,
}: PostSidebarActionsProps) {
  return (
    <div className="flex items-center justify-end gap-2">
      <PostPublicActionButtons postSlug={postSlug} />
      <PostAdminActionButtons
        boardSlug={boardSlug}
        canManagePost={canManagePost}
        lockedAt={lockedAt}
        organizationId={organizationId}
        postId={postId}
      />
    </div>
  );
}

const PostPublicActionButtons = memo(function PostPublicActionButtons({
  postSlug,
}: {
  postSlug: string;
}) {
  return (
    <>
      <RedirectToPostUrlButton postSlug={postSlug} />
      <CopyPostButton postSlug={postSlug} />
    </>
  );
});

function PostAdminActionButtons({
  boardSlug,
  canManagePost,
  lockedAt,
  organizationId,
  postId,
}: {
  boardSlug: string;
  canManagePost: boolean;
  lockedAt: Date | string | null;
  organizationId: string;
  postId: string;
}) {
  const postDialogStore = usePostDeleteDialogContext();
  const [dialogAction, setDialogAction] = useState<DialogAction>(null);
  const [pendingAction, setPendingAction] = useState<PostAdminAction | null>(
    null
  );

  const isLocked = lockedAt !== null;
  const lockLabel = isLocked ? "Unlock post" : "Lock post";

  const updatePostAdminState = createOptimisticAction<{
    locked: boolean;
  }>({
    onMutate: ({ locked }) => {
      postCollection.update(postId, (draft) => {
        draft.lockedAt = locked ? new Date() : null;
      });
    },
    mutationFn: async ({ locked }) => {
      await fetchRpc((rpc) =>
        rpc.PostAdminUpdate({
          id: postId,
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
        title:
          isLocked ? "Post unlocked" : "Post locked",
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
            <TooltipContent>{lockLabel}</TooltipContent>
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
                        postId,
                        redirectOptions: {
                          to: "/$organizationId/board/$boardSlug",
                          params: {
                            organizationId,
                            boardSlug,
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
            <TooltipContent>Delete post</TooltipContent>
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
      <AlertDialogContent>
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
      </AlertDialogContent>
    </AlertDialog>
  );
}

function RedirectToPostUrlButton({ postSlug }: { postSlug: string }) {
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
            nativeButton={false}
            render={(buttonProps) => (
              <a
                {...buttonProps}
                href={`${publicSiteUrl}/p/${postSlug}`}
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
      <TooltipContent>Go to Public Post</TooltipContent>
    </Tooltip>
  );
}

function CopyPostButton({ postSlug }: { postSlug: string }) {
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
                navigator.clipboard.writeText(`${publicSiteUrl}/p/${postSlug}`);
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
      <TooltipContent>Copy post link</TooltipContent>
    </Tooltip>
  );
}
