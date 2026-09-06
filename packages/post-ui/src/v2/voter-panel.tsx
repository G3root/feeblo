import type { TPostCreateAuthor } from "@feeblo/domain/post/schema";
import type { TUpvote } from "@feeblo/domain/upvote/schema";
import {
  Avatar,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
  AvatarImage,
} from "@feeblo/ui/avatar";
import { Button } from "@feeblo/ui/button";
import {
  Dialog,
  DialogHeader,
  DialogPopup,
  DialogTitle,
} from "@feeblo/ui/dialog";
import { Popover, PopoverPopup, PopoverTrigger } from "@feeblo/ui/popover";
import { Skeleton } from "@feeblo/ui/skeleton";
import { toastManager } from "@feeblo/ui/toast";
import { cn } from "@feeblo/ui/utils";
import { parseRpcError } from "@feeblo/web-shared/rpc-error";
import { fetchRpc } from "@feeblo/web-shared/runtime";
import { useAuthState } from "@feeblo/web-shared/use-auth-state";
import { hasPermission, usePolicy } from "@feeblo/web-shared/use-policy";
import {
  Cancel01Icon,
  ThumbsUpIcon,
  UserAdd01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { and, eq, useLiveQuery } from "@tanstack/react-db";
import { useState } from "react";

import {
  ContactCombobox,
  type ContactComboboxSelection,
  toOnBehalfAuthor,
} from "./contact-combobox/contact-combobox";
import {
  NewUserDialog,
  NewUserFooter,
} from "./contact-combobox/new-user-dialog";
import { usePostCollectionData } from "./post-page-context";
import { usePostCollections } from "./providers/post-collections-provider";

function VoterAvatar({
  className,
  upvote,
}: {
  className?: string;
  upvote: TUpvote;
}) {
  return (
    <Avatar className={cn("shrink-0", className)} size="sm">
      {upvote.user.image ? <AvatarImage src={upvote.user.image} /> : null}
      <AvatarFallback>
        {(upvote.user.name ?? "?").slice(0, 1).toUpperCase()}
      </AvatarFallback>
    </Avatar>
  );
}

/**
 * Dashboard voter management for a post: lists the current voters and lets
 * members with `votes.onBehalf` add voters through the contact picker
 * (`UpvoteAddOnBehalf`) or remove an individual voter
 * (`UpvoteRemoveOnBehalf`). Removal is deliberately confirm-free — the action
 * is activity-logged and re-addable.
 */
export function VoterPanel() {
  const { post, organizationId } = usePostCollectionData();
  const {
    collections: { upvoteCollection },
  } = usePostCollections();
  const { data: session } = useAuthState();
  const votesOnBehalfPolicy = usePolicy(
    hasPermission(organizationId, "votes.onBehalf")
  );
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  const { data: upvotes = [], isLoading } = useLiveQuery(
    (q) =>
      q
        .from({ upvote: upvoteCollection })
        .where(({ upvote }) =>
          and(
            eq(upvote.organizationId, organizationId),
            eq(upvote.postId, post.id)
          )
        ),
    [organizationId, post.id]
  );

  // Plain async functions, deliberately NOT createOptimisticAction: that API
  // skips mutationFn entirely when onMutate stages zero collection
  // operations (commit early-returns on an empty mutation list), which made
  // add/remove silently no-op. Every vote count in the UI derives from the
  // upvote collection client-side (post rows carry no vote count), so
  // refetching it alone is the full invalidation.
  const addVoter = async ({ author }: { author: TPostCreateAuthor }) => {
    await fetchRpc((rpc) =>
      rpc.UpvoteAddOnBehalf({
        author,
        organizationId,
        postId: post.id,
      })
    );
    await upvoteCollection.utils.refetch();
  };

  const removeVoter = async ({ userId }: { userId: string }) => {
    await fetchRpc((rpc) =>
      rpc.UpvoteRemoveOnBehalf({
        organizationId,
        postId: post.id,
        userId,
      })
    );
    await upvoteCollection.utils.refetch();
  };

  const handleAdd = async (selection: ContactComboboxSelection | null) => {
    if (!selection) {
      return;
    }
    try {
      await addVoter({ author: toOnBehalfAuthor(selection) });
      setIsAddOpen(false);
    } catch (error) {
      toastManager.add({
        title: parseRpcError(error).message,
        type: "error",
      });
    }
  };

  // The shared dialog collects the name/email; an address that turns out
  // to belong to an existing contact or member resolves to them instead
  // of duplicating — the RPC is idempotent either way.
  const handleCreateAndVote = async ({
    email,
    name,
  }: {
    email: string;
    name: string;
  }) => {
    await addVoter({ author: { email, name } });
    setIsAddOpen(false);
  };

  const handleRemove = async (userId: string) => {
    try {
      await removeVoter({ userId });
    } catch (error) {
      toastManager.add({
        title: parseRpcError(error).message,
        type: "error",
      });
    }
  };

  return (
    <section aria-label="Voters" className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium">
          <HugeiconsIcon
            className="size-3.5"
            icon={ThumbsUpIcon}
            strokeWidth={2}
          />
          Voters ({upvotes.length})
        </h2>
        {session && votesOnBehalfPolicy.allowed ? (
          <Popover onOpenChange={setIsAddOpen} open={isAddOpen}>
            <PopoverTrigger
              render={
                <Button size="sm" type="button" variant="ghost">
                  <HugeiconsIcon icon={UserAdd01Icon} strokeWidth={2} />
                  Add voter
                </Button>
              }
            />
            <PopoverPopup align="end" className="w-64 p-1">
              <ContactCombobox
                label="Add voter"
                onSelect={handleAdd}
                organizationId={organizationId}
                placeholder="Search customers by name or email..."
                postId={post.id}
                value={null}
              />
              <NewUserFooter onNewUser={() => setIsCreateOpen(true)}>
                Add new upvoter
              </NewUserFooter>
            </PopoverPopup>
          </Popover>
        ) : null}
      </div>

      <NewUserDialog
        onOpenChange={setIsCreateOpen}
        onSubmit={handleCreateAndVote}
        open={isCreateOpen}
        submitLabel="Create & add vote"
      />

      {isLoading ? (
        <Skeleton className="h-8 w-full" />
      ) : upvotes.length === 0 ? (
        <p className="text-muted-foreground text-xs">No voters yet.</p>
      ) : (
        <Dialog onOpenChange={setIsDialogOpen} open={isDialogOpen}>
          <button
            aria-label={`Show all ${upvotes.length} voters`}
            className="flex items-center transition-opacity hover:opacity-80"
            onClick={() => setIsDialogOpen(true)}
            type="button"
          >
            <AvatarGroup>
              {upvotes.slice(0, 5).map((upvote) => (
                <VoterAvatar
                  className="ring-background ring-2"
                  key={upvote.id}
                  upvote={upvote}
                />
              ))}
              {upvotes.length > 5 ? (
                <AvatarGroupCount>+{upvotes.length - 5}</AvatarGroupCount>
              ) : null}
            </AvatarGroup>
          </button>
          <DialogPopup>
            <DialogHeader>
              <DialogTitle>Voters ({upvotes.length})</DialogTitle>
            </DialogHeader>
            <ul className="max-h-80 space-y-1 overflow-y-auto px-6 pb-6">
              {upvotes.map((upvote) => {
                const canRemove = Boolean(
                  session && votesOnBehalfPolicy.allowed && upvote.userId
                );
                return (
                  <li
                    className="group flex items-center gap-2 rounded-md px-1 py-1"
                    key={upvote.id}
                  >
                    <VoterAvatar upvote={upvote} />
                    <span
                      className={cn(
                        "min-w-0 flex-1 truncate text-sm",
                        !upvote.user.name && "text-muted-foreground"
                      )}
                    >
                      {upvote.user.name ?? "Customer"}
                    </span>
                    {canRemove ? (
                      <Button
                        aria-label={`Remove voter ${upvote.user.name ?? "customer"}`}
                        className="opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"
                        onClick={() => {
                          if (!upvote.userId) {
                            return;
                          }
                          handleRemove(upvote.userId);
                        }}
                        size="icon-xs"
                        type="button"
                        variant="ghost"
                      >
                        <HugeiconsIcon icon={Cancel01Icon} />
                      </Button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </DialogPopup>
        </Dialog>
      )}
    </section>
  );
}
