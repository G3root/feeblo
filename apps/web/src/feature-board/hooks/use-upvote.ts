import { type LegidOf, UpvoteId } from "@feeblo/id";
import { toastManager } from "@feeblo/ui/toast";
import { createOptimisticAction } from "@tanstack/react-db";
import { authClient } from "~/lib/auth-client";
import { getUpvoteCollectionKey } from "~/lib/reaction-keys";
import { fetchRpc } from "~/lib/runtime";
import { usePublicCollections } from "../providers/public-collections-provider";

type SessionMembership = {
  membershipId: string;
  organizationId: string;
  userId: string;
};

export function useUpvote() {
  const { data: session } = authClient.useSession();
  const { publicPostCollection, publicUpvoteCollection } =
    usePublicCollections();

  const toggleUpvote = createOptimisticAction<{
    disabled?: boolean;
    postId: string;
    organizationId: string;
    existingUpvote: boolean;
    upvoteId: LegidOf<"UpvoteId">;
  }>({
    onMutate: ({
      disabled = false,
      postId,
      organizationId,
      existingUpvote,
      upvoteId,
    }) => {
      if (disabled) {
        return;
      }

      const currentUserId = session?.user?.id;

      if (!currentUserId) {
        toastManager.add({ title: "Sign in to upvote", type: "error" });
        return;
      }

      const memberships = (
        session as { memberships?: SessionMembership[] } | null
      )?.memberships;
      const isMember = memberships?.find(
        (membership: SessionMembership) =>
          membership.userId === currentUserId &&
          membership.organizationId === organizationId
      );

      // TODO : use query once API
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
        id: upvoteId,
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
      { disabled = false, postId, organizationId },
      _params
    ) => {
      if (disabled) {
        return;
      }

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

  const handleToggleUpvote = async (args: {
    disabled?: boolean;
    postId: string;
    organizationId: string;
    existingUpvote: boolean;
  }) => {
    const upvoteId = await UpvoteId.unsafeGenerate();
    return toggleUpvote({ ...args, upvoteId });
  };

  return {
    handleToggleUpvote,
  };
}
