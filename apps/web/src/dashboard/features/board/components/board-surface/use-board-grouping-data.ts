import type { TBoardGroupBy } from "@feeblo/domain-contracts/board-query";
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
export function useBoardGroupingData(
  organizationId: string,
  groupBy: TBoardGroupBy
) {
  const { postTagCollection } = useDashboardCollections();
  const membersQuery = useOrgMembers(organizationId);
  const tagsQuery = useOrgTags(organizationId);
  const organizationMembers = membersQuery.data;
  const tags = tagsQuery.data;

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
    // A failed read only fails the board when the active grouping actually
    // reads it: member names for assignee lanes, labels and post-tag rows for
    // label lanes. An unrelated read hiccup must not replace the board with an
    // error screen.
    hasError:
      (groupBy === "assignee" && isLiveQueryFailed(membersQuery)) ||
      (groupBy === "label" &&
        (isLiveQueryFailed(postTagsQuery) || isLiveQueryFailed(tagsQuery))),
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
