import type { TPostCreateAuthor } from "@feeblo/domain/post/schema";
import { AuthorPicker } from "@feeblo/post-ui/author-picker";
import {
  toOnBehalfAuthor,
  type ContactComboboxSelection,
} from "@feeblo/post-ui/contact-combobox";
import { usePostCollectionData } from "@feeblo/post-ui/post-page-context";
import { Badge } from "@feeblo/ui/badge";
import { toastManager } from "@feeblo/ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@feeblo/ui/tooltip";
import { trackEvent } from "@feeblo/web-shared/analytics-provider";
import { refetchInBackground } from "@feeblo/web-shared/collections";
import { parseRpcError } from "@feeblo/web-shared/rpc-error";
import { hasPermission, usePolicy } from "@feeblo/web-shared/use-policy";
import { UserBlock01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { fetchRpc } from "~/lib/runtime";
import { useDashboardCollections } from "~/providers/dashboard-collections-provider";

import { GHOST_PROPERTY_TRIGGER } from "../lib/property-trigger";

/**
 * Dashboard author picker for a post, shown in the details sidebar. Wraps
 * the shared {@link AuthorPicker} with the dashboard's permission gate and
 * `UpdatePostAuthor` persistence: picking a person — or creating one —
 * reattributes the post and refreshes the post + activity collections.
 *
 * Self-gates with the permission the backend enforces
 * (`posts.createOnBehalf`, managers and above): without it (or on a locked
 * post) the author renders as static text.
 */
export function PostAuthorField() {
  const { post, organizationId, isLocked, isMerged } = usePostCollectionData();
  const { postCollection, postActivityCollection } = useDashboardCollections();
  // Backend mirror: PostPolicy.canUpdateAuthor lets `posts.createOnBehalf`
  // holders (managers and above) reattribute a post via UpdatePostAuthor.
  const { allowed: canUpdateAuthor } = usePolicy(
    hasPermission(organizationId, "posts.createOnBehalf")
  );

  const updateAuthor = async (author: TPostCreateAuthor) => {
    try {
      await fetchRpc((rpc) =>
        rpc.UpdatePostAuthor({
          id: post.id,
          organizationId,
          author,
        })
      );
      // The author join (`post.user`) derives from the affected post row, so
      // its read-back is awaited — settled, because a refetch failure after a
      // successful write must not surface as an update failure. The
      // AUTHOR_CHANGED timeline entry is derived too but does not gate the
      // toast, so it refreshes detached.
      await Promise.allSettled([postCollection.utils.refetch()]);
      refetchInBackground(postActivityCollection.utils.refetch());
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
    <div className="flex items-center gap-1.5">
      <div className="min-w-0 flex-1">
        <AuthorPicker
          disabled={isLocked || isMerged || !canUpdateAuthor}
          display={{
            name: post.user.name ?? "Unknown author",
            avatarUrl: post.user.image,
          }}
          label="Change author"
          onSelect={handleSelect}
          organizationId={organizationId}
          postId={post.id}
          searchPlaceholder="Search users..."
          showTrigger={false}
          triggerClassName={GHOST_PROPERTY_TRIGGER}
          value={null}
        />
      </div>
      {/* A ban does not hide the author or their content, so without this the
          sidebar gives no sign that the person writing on this post can no
          longer comment, vote, or react here. It is an indicator rather than
          an action: unbanning lives on the security settings page, where the
          rest of the ban list is. A member never draws it: the server refuses to
          ban staff, so a row naming one is left over from before they joined
          and has no effect. */}
      {post.authorIsBanned === true && !post.authorIsMember ? (
        <Tooltip>
          <TooltipTrigger
            render={(props) => (
              <Badge {...props} aria-label="Banned author" variant="error">
                <HugeiconsIcon icon={UserBlock01Icon} />
              </Badge>
            )}
          />
          <TooltipPopup>
            This author is banned from participating here. They can still read,
            but they cannot post, comment, vote, react, or subscribe until the
            ban is removed in settings.
          </TooltipPopup>
        </Tooltip>
      ) : null}
    </div>
  );
}
