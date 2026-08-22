import type { TPostCreateAuthor } from "@feeblo/domain/post/schema";
import type { TUpvote } from "@feeblo/domain/upvote/schema";
import { Avatar, AvatarFallback, AvatarImage } from "@feeblo/ui/avatar";
import { Button } from "@feeblo/ui/button";
import { Skeleton } from "@feeblo/ui/skeleton";
import { toastManager } from "@feeblo/ui/toast";
import { cn } from "@feeblo/ui/utils";
import { parseRpcError } from "@feeblo/web-shared/rpc-error";
import { fetchRpc } from "@feeblo/web-shared/runtime";
import { hasPermission, usePolicy } from "@feeblo/web-shared/use-policy";
import { useAuthState } from "@feeblo/web-shared/use-auth-state";
import {
  Cancel01Icon,
  ThumbsUpIcon,
  UserAdd01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { and, createOptimisticAction, eq, useLiveQuery } from "@tanstack/react-db";
import { useState } from "react";

import {
  ContactCombobox,
  type ContactComboboxSelection,
  toOnBehalfAuthor,
} from "./contact-combobox/contact-combobox";
import { usePostCollectionData } from "./post-page-context";
import { usePostCollections } from "./providers/post-collections-provider";

function VoterAvatar({ upvote }: { upvote: TUpvote }) {
  return (
    <Avatar className="shrink-0" size="sm">
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
    collections: { postCollection, upvoteCollection },
  } = usePostCollections();
  const { data: session } = useAuthState();
  const votesOnBehalfPolicy = usePolicy(
    hasPermission(organizationId, "votes.onBehalf")
  );
  const [isPickerOpen, setIsPickerOpen] = useState(false);

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

  const addVoter = createOptimisticAction<{ author: TPostCreateAuthor }>({
    onMutate: () => {},
    mutationFn: async ({ author }) => {
      await fetchRpc((rpc) =>
        rpc.UpvoteAddOnBehalf({
          author,
          organizationId,
          postId: post.id,
        })
      );
      // The RPC acknowledges with a payload ({added}); the refetches are the
      // invalidation that brings the updated voter row, vote count and
      // activity back.
      await upvoteCollection.utils.refetch();
      await postCollection.utils.refetch();
    },
  });

  const removeVoter = createOptimisticAction<{ userId: string }>({
    onMutate: () => {},
    mutationFn: async ({ userId }) => {
      await fetchRpc((rpc) =>
        rpc.UpvoteRemoveOnBehalf({
          organizationId,
          postId: post.id,
          userId,
        })
      );
      // The RPC acknowledges with a payload ({removed}); the refetches are
      // the invalidation that brings the updated voter row, vote count and
      // activity back.
      await upvoteCollection.utils.refetch();
      await postCollection.utils.refetch();
    },
  });

  const handleAdd = async (selection: ContactComboboxSelection | null) => {
    if (!selection) {
      return;
    }
    try {
      await addVoter({ author: toOnBehalfAuthor(selection) });
      setIsPickerOpen(false);
    } catch (error) {
      toastManager.add({
        title: parseRpcError(error).message,
        type: "error",
      });
    }
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
          <HugeiconsIcon className="size-3.5" icon={ThumbsUpIcon} strokeWidth={2} />
          Voters ({upvotes.length})
        </h2>
        {session && votesOnBehalfPolicy.allowed ? (
          <Button
            aria-expanded={isPickerOpen}
            onClick={() => setIsPickerOpen((open) => !open)}
            size="sm"
            type="button"
            variant="ghost"
          >
            <HugeiconsIcon icon={UserAdd01Icon} strokeWidth={2} />
            Add voter
          </Button>
        ) : null}
      </div>

      {isPickerOpen && votesOnBehalfPolicy.allowed ? (
        <ContactCombobox
          label="Add voter"
          onSelect={handleAdd}
          organizationId={organizationId}
          placeholder="Search customers by name or email..."
          postId={post.id}
          value={null}
        />
      ) : null}

      {isLoading ? (
        <Skeleton className="h-8 w-full" />
      ) : upvotes.length === 0 ? (
        <p className="text-muted-foreground text-xs">No voters yet.</p>
      ) : (
        <ul className="space-y-1">
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
      )}
    </section>
  );
}
