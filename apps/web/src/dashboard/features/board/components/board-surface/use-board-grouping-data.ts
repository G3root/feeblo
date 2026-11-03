import { isLiveQueryFailed } from "@feeblo/web-shared/collections";
import { eq, useLiveQuery } from "@tanstack/react-db";
import { useMemo } from "react";

import { useOrgMembers } from "~/hooks/use-org-members";
import { useOrgTags } from "~/hooks/use-org-tags";
import { useDashboardCollections } from "~/providers/dashboard-collections-provider";

import type { BoardGroupingMember, BoardGroupingTag } from "./types";

/**
 * The names behind the lanes a board can be grouped by.
 *
 * A board read carries the assignee's member id, the board id/name, and the
 * status; labels are the one grouping that needs a second relation, because a
 * post may hold several. The post-tag rows are read once for the workspace and
 * indexed by post, so the grouping function does not scan the tag table per
 * post. `isCurrentUser` is deliberately absent: a grouping lane is a fact about
 * the work, not a shortcut like the filter menu's "Assigned to me" entry.
 */
export function useBoardGroupingData(organizationId: string) {
  const { postTagCollection } = useDashboardCollections();
  const { data: organizationMembers } = useOrgMembers(organizationId);
  const { data: tags } = useOrgTags(organizationId);

  const postTagsQuery = useLiveQuery({
    queryKey: ["board-post-tags", postTagCollection.id, organizationId],
    query: (q) =>
      q
        .from({ postTag: postTagCollection })
        .where(({ postTag }) => eq(postTag.organizationId, organizationId))
        .select(({ postTag }) => ({
          postId: postTag.postId,
          tagId: postTag.tagId,
        })),
  });
  const postTags = postTagsQuery.data;

  const members = useMemo<BoardGroupingMember[]>(
    () =>
      (organizationMembers ?? [])
        .map((member) => ({
          id: member.id,
          name: member.user.name || member.user.email,
        }))
        .toSorted((left, right) => left.name.localeCompare(right.name)),
    [organizationMembers]
  );

  const postTagsByPostId = useMemo(() => {
    const map = new Map<string, string[]>();

    for (const row of postTags ?? []) {
      const tagIds = map.get(row.postId);

      if (tagIds) {
        tagIds.push(row.tagId);
      } else {
        map.set(row.postId, [row.tagId]);
      }
    }

    return map;
  }, [postTags]);

  return {
    hasError: isLiveQueryFailed(postTagsQuery),
    members,
    postTagsByPostId,
    tags: tags ?? [],
  } satisfies {
    hasError: boolean;
    members: BoardGroupingMember[];
    postTagsByPostId: ReadonlyMap<string, string[]>;
    tags: BoardGroupingTag[];
  };
}
