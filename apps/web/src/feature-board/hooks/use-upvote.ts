import { generateId } from "@feeblo/utils/id";
import { createOptimisticAction } from "@tanstack/react-db";
import { toastManager } from "~/components/ui/toast";
import { authClient } from "~/lib/auth-client";
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
    revalidateExistingUpvote: { id: string } | undefined;
    insertNewUpvote: boolean;
  }>({
    onMutate: ({
      postId,
      organizationId,
      existingUpvote,
      revalidateExistingUpvote,
      insertNewUpvote,
    }) => {
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

      if (existingUpvote) {
        if (revalidateExistingUpvote) {
          publicUpvoteCollection.delete(revalidateExistingUpvote.id);
        }
        publicPostCollection.update(postId, (draft) => {
          draft.hasUserUpVoted = false;
          draft.upVotes -= 1;
        });
      } else {
        if (insertNewUpvote) {
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
        }
        publicPostCollection.update(postId, (draft) => {
          draft.hasUserUpVoted = true;
          draft.upVotes += 1;
        });
      }
    },
    mutationFn: async (
      { postId, organizationId, revalidateExistingUpvote, insertNewUpvote },
      _params
    ) => {
      await fetchRpc((rpc) =>
        rpc.UpvoteToggle({
          organizationId,
          postId,
        })
      );

      const promises: Promise<unknown>[] = [];

      if (revalidateExistingUpvote || insertNewUpvote) {
        promises.push(publicUpvoteCollection.utils.refetch());
      }
      promises.push(publicPostCollection.utils.refetch());

      await Promise.all(promises);
    },
  });

  return {
    handleToggleUpvote,
  };
}
