import type { TPostCreateAuthor } from "@feeblo/domain/post/schema";
import { AuthorPicker } from "@feeblo/post-ui/author-picker";
import {
  toOnBehalfAuthor,
  type ContactComboboxSelection,
} from "@feeblo/post-ui/contact-combobox";
import { usePostCollectionData } from "@feeblo/post-ui/post-page-context";
import { toastManager } from "@feeblo/ui/toast";
import { trackEvent } from "@feeblo/web-shared/analytics-provider";
import { parseRpcError } from "@feeblo/web-shared/rpc-error";
import { hasPermission, usePolicy } from "@feeblo/web-shared/use-policy";

import { fetchRpc } from "~/lib/runtime";
import { useDashboardCollections } from "~/providers/dashboard-collections-provider";

/**
 * Dashboard author picker for a post, shown in the details sidebar. Wraps
 * the shared {@link AuthorPicker} with the dashboard's permission gate and
 * `PostUpdateAuthor` persistence: picking a person — or creating one —
 * reattributes the post and refreshes the post + activity collections.
 *
 * Self-gates with the permission the backend enforces
 * (`posts.createOnBehalf`, managers and above): without it (or on a locked
 * post) the author renders as static text.
 */
export function PostAuthorField() {
  const { post, organizationId, isLocked } = usePostCollectionData();
  const { postCollection, postActivityCollection } = useDashboardCollections();
  // Backend mirror: PostPolicy.canUpdateAuthor lets `posts.createOnBehalf`
  // holders (managers and above) reattribute a post via PostUpdateAuthor.
  const { allowed: canUpdateAuthor } = usePolicy(
    hasPermission(organizationId, "posts.createOnBehalf")
  );

  const updateAuthor = async (author: TPostCreateAuthor) => {
    try {
      await fetchRpc((rpc) =>
        rpc.PostUpdateAuthor({
          id: post.id,
          organizationId,
          author,
        })
      );
      // The author join (`post.user`) and the AUTHOR_CHANGED timeline entry
      // both derive from refetched collections; a refetch failure after a
      // successful write must not surface as an update failure.
      await Promise.allSettled([
        postCollection.utils.refetch(),
        postActivityCollection.utils.refetch(),
      ]);
      trackEvent("post_updated", { field: "author", success: true });
      toastManager.add({
        title: "Author updated",
        type: "success",
      });
    } catch (error) {
      trackEvent("post_updated", { field: "author", success: false });
      toastManager.add({
        title: parseRpcError(error).message,
        type: "error",
      });
    }
  };

  const handleSelect = async (selection: ContactComboboxSelection | null) => {
    if (!selection) {
      return;
    }
    await updateAuthor(toOnBehalfAuthor(selection));
  };

  return (
    <AuthorPicker
      disabled={isLocked || !canUpdateAuthor}
      display={{
        name: post.user.name ?? "Unknown author",
        avatarUrl: post.user.image,
      }}
      label="Change author"
      onSelect={handleSelect}
      organizationId={organizationId}
      postId={post.id}
      searchPlaceholder="Search users..."
      value={null}
    />
  );
}
