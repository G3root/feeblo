import { generateId } from "@feeblo/utils/id";
import { createOptimisticAction } from "@tanstack/react-db";
import { toastManager } from "~/components/ui/toast";
import { authClient } from "~/lib/auth-client";
import { getUpvoteCollectionKey } from "~/lib/reaction-keys";
import { fetchRpc } from "~/lib/runtime";
import {
  publicPostCollection,
  publicUpvoteCollection,
} from "../lib/collections";

export function useUpvote() {
  const { data: session } = authClient.useSession();

  const handleToggleUpvote = createOptimisticAction<{
    postId: string;
    organizationId: string;
    existingUpvote: boolean;
  }>({
    onMutate: ({ postId, organizationId, existingUpvote }) => {
      const currentUserId = session?.user?.id;

      if (!currentUserId) {
        toastManager.add({ title: "Sign in to upvote", type: "error" });
        return;
      }

      const isMember = session?.memberships?.find(
        (membership) =>
          membership.userId === currentUserId &&
          membership.organizationId === organizationId
      );

      const existingUpvoteRecord = Array.from(
        publicUpvoteCollection.values()
      ).find(
        (upvote) =>
          upvote.postId === postId &&
          upvote.userId === currentUserId &&
          upvote.organizationId === organizationId
      );

      if (existingUpvoteRecord || existingUpvote) {
        if (existingUpvoteRecord) {
          publicUpvoteCollection.delete(
            getUpvoteCollectionKey(existingUpvoteRecord)
          );
        }
        publicPostCollection.update(postId, (draft) => {
          draft.hasUserUpVoted = false;
          draft.upVotes -= 1;
        });
        return;
      }

      publicUpvoteCollection.insert({
        id: generateId("upvote"),
        createdAt: new Date(),
        updatedAt: new Date(),
        organizationId,
        postId,
        userId: currentUserId,
        memberId: isMember ? isMember.membershipId : null,
        user: {
          name: session?.user?.name ?? null,
          image: session?.user?.image ?? null,
        },
      });

      publicPostCollection.update(postId, (draft) => {
        draft.hasUserUpVoted = true;
        draft.upVotes += 1;
      });
    },
    mutationFn: async (
      { postId, organizationId },
      _params
    ) => {
      await fetchRpc((rpc) =>
        rpc.UpvoteToggle({
          organizationId,
          postId,
        })
      );

      await Promise.all([
        publicUpvoteCollection.utils.refetch(),
        publicPostCollection.utils.refetch(),
      ]);
    },
  });

  return {
    handleToggleUpvote,
  };
}
