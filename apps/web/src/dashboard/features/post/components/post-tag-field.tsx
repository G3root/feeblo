import { usePostCollectionData } from "@feeblo/post-ui/post-page-context";
import { toastManager } from "@feeblo/ui/toast";
import {
  allPolicy,
  anyPolicy,
  hasMembership,
  hasPermission,
  isUser,
  usePolicy,
} from "@feeblo/web-shared/use-policy";
import { and, eq, useLiveQuery } from "@tanstack/react-db";
import { TagCreateDialog } from "~/features/tag/components/tag-create-dialog";
import {
  TagSelect,
  type TagSelectOption,
} from "~/features/tag/components/tag-select";
import { TagCreateDialogProvider } from "~/features/tag/dialog-stores";
import { tagCollection } from "~/lib/collections";
import { fetchRpc } from "~/lib/runtime";
import { useDashboardCollections } from "~/providers/dashboard-collections-provider";

export function PostTagField() {
  const { post, organizationId, isLocked } = usePostCollectionData();
  // Backend mirror: TagPolicy.canSetPostTags = membership AND
  // (posts.* OR tags.* OR post creator). Contributors keep the tag field on
  // their own posts; everyone else needs manager-level posts/tags grants.
  const { allowed: canChangeTags } = usePolicy(
    anyPolicy(
      hasPermission(organizationId, "posts.*"),
      hasPermission(organizationId, "tags.*"),
      allPolicy(hasMembership(organizationId), isUser(post.creatorId ?? ""))
    )
  );
  const { allowed: canCreateTags } = usePolicy(
    hasPermission(organizationId, "tags.create")
  );

  const disabled = isLocked || !canChangeTags;
  const { postTagCollection } = useDashboardCollections();

  const { data: tags } = useLiveQuery(
    (q) => {
      return q
        .from({ tags: tagCollection })
        .where(({ tags }) =>
          and(
            eq(tags.organizationId, organizationId),
            eq(tags.type, "FEEDBACK")
          )
        )
        .select(({ tags }) => ({
          id: tags.id,
          name: tags.name,
          type: tags.type,
        }));
    },
    [organizationId]
  );

  const { data: postTags } = useLiveQuery(
    (q) => {
      if (!post.id) {
        return undefined;
      }
      return q
        .from({ tags: postTagCollection })
        .where(({ tags }) =>
          and(eq(tags.postId, post.id), eq(tags.organizationId, organizationId))
        )
        .select(({ tags }) => ({
          id: tags.id,
          tagId: tags.tagId,
          typeId: tags.postId,
        }));
    },
    [organizationId, post.id]
  );

  const handleTagSelect = async (
    option: TagSelectOption,
    isSelected: boolean,
    showSuccessToast = true
  ) => {
    if (disabled) {
      return;
    }
    try {
      if (!postTags) {
        return;
      }
      const currentTagIds = postTags.map((tag) => tag.tagId);
      const newTagIds = isSelected
        ? currentTagIds?.filter((id) => id !== option.id)
        : [...currentTagIds, option.id];

      await fetchRpc((rpc) =>
        rpc.PostTagSet({
          postId: post.id,
          organizationId,
          tagIds: newTagIds,
        })
      );

      await postTagCollection.utils.refetch();

      if (showSuccessToast) {
        toastManager.add({
          title: "Tags updated",
          type: "success",
        });
      }
    } catch {
      toastManager.add({
        title: "Failed to update tags",
        type: "error",
      });
    }
  };

  return (
    <TagCreateDialogProvider defaultValue={{ data: { type: "FEEDBACK" } }}>
      <TagSelect
        canCreate={canCreateTags}
        disabled={disabled}
        onTagSelect={handleTagSelect}
        selectedTags={postTags ?? []}
        tags={tags}
        type="FEEDBACK"
      />
      {/* Always mounted like the settings routes; the create button in
          TagSelect is disabled without tags.create, so the dialog can never
          open for users who lack the permission. */}
      <TagCreateDialog
        onCreated={(tag) => handleTagSelect(tag, false, false)}
      />
    </TagCreateDialogProvider>
  );
}
