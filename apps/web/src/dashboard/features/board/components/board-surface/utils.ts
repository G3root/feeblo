import type { TBoardGroupBy } from "@feeblo/domain-contracts/board-query";
import type { BoardPostStatus } from "@feeblo/web-shared/board/constants";

import type {
  BoardGroupingMember,
  BoardGroupingTag,
  BoardPostLane,
  BoardPostRow,
} from "./types";

type BoardGroupingStatus = {
  id: string;
  label: string;
  type: BoardPostStatus;
};

export function formatPostDate(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Recently";
  }

  return date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  });
}

/**
 * Splits the board's result set into the lanes the active grouping names.
 *
 * Every grouping reads the same post rows; only the key changes. A lane is
 * therefore a presentation over one result set, not another query, and a saved
 * view can change its grouping without changing its match. `label` is the one
 * grouping that may put a post in more than one lane, because a post can carry
 * several labels; `none` puts every post in one unlabelled lane.
 *
 * A lane's id is what React keys it by and what the grid's drop target reads.
 * It is a real id (`statusId`, member id, board id, tag id) so a re-grouping
 * does not churn lane identity, and `none` uses the fixed `"all"`.
 */
export function groupBoardPosts({
  groupBy,
  members,
  posts,
  postStatuses,
  postTagsByPostId,
  tags,
}: {
  groupBy: TBoardGroupBy;
  members: readonly BoardGroupingMember[];
  posts: readonly BoardPostRow[];
  postStatuses: readonly BoardGroupingStatus[];
  postTagsByPostId: ReadonlyMap<string, readonly string[]>;
  tags: readonly BoardGroupingTag[];
}): BoardPostLane[] {
  switch (groupBy) {
    case "status":
      return groupByStatus(posts, postStatuses);
    case "assignee":
      return groupByAssignee(posts, members);
    case "board":
      return groupByBoard(posts);
    case "label":
      return groupByLabel(posts, tags, postTagsByPostId);
    case "none":
      return posts.length === 0
        ? []
        : [{ id: "all", label: "All posts", posts: [...posts] }];
  }
}

function groupByStatus(
  posts: readonly BoardPostRow[],
  orderedStatuses: readonly BoardGroupingStatus[]
): BoardPostLane[] {
  const postsByStatusId = Map.groupBy(posts, (post) => post.statusId);
  const orderedStatusIds = new Set(orderedStatuses.map((status) => status.id));

  const orderedLanes = orderedStatuses.flatMap((status) => {
    const statusPosts = postsByStatusId.get(status.id) ?? [];

    return statusPosts.length === 0
      ? []
      : [
          {
            id: status.id,
            label: status.label,
            posts: statusPosts,
            status: status.type,
            statusId: status.id,
          },
        ];
  });

  const unknownLanes = [...postsByStatusId.entries()].flatMap(
    ([statusId, statusPosts]) => {
      if (orderedStatusIds.has(statusId)) {
        return [];
      }

      const firstPost = statusPosts[0];

      return firstPost === undefined
        ? []
        : [
            {
              id: statusId,
              label: "",
              posts: statusPosts,
              status: firstPost.status,
              statusId,
            },
          ];
    }
  );

  return [...orderedLanes, ...unknownLanes];
}

function groupByAssignee(
  posts: readonly BoardPostRow[],
  members: readonly BoardGroupingMember[]
): BoardPostLane[] {
  const assignedPosts = posts.filter(
    (post): post is BoardPostRow & { assigneeMemberId: string } =>
      post.assigneeMemberId !== null
  );

  const byMember = Map.groupBy(assignedPosts, (post) => post.assigneeMemberId);

  const memberIds = new Set(members.map((member) => member.id));

  const memberLanes = members.flatMap((member) => {
    const memberPosts = byMember.get(member.id);

    return memberPosts?.length
      ? [{ id: member.id, label: member.name, posts: memberPosts }]
      : [];
  });

  // A post can name a member row this page has not loaded yet. Keeping the
  // posts under the id is better than dropping them; the name is the only
  // thing missing.
  const unknownLanes = [...byMember.entries()].flatMap(
    ([memberId, memberPosts]) =>
      memberIds.has(memberId)
        ? []
        : [{ id: memberId, label: "Unknown member", posts: memberPosts }]
  );

  const unassigned = posts.filter((post) => post.assigneeMemberId === null);

  const unassignedLanes =
    unassigned.length > 0
      ? [{ id: "unassigned", label: "Unassigned", posts: unassigned }]
      : [];

  return [...memberLanes, ...unknownLanes, ...unassignedLanes];
}

function groupByBoard(posts: readonly BoardPostRow[]): BoardPostLane[] {
  return [...Map.groupBy(posts, (post) => post.boardId).entries()]
    .map(([id, boardPosts]) => ({
      id,
      label: boardPosts[0]?.boardName || "No board",
      posts: boardPosts,
    }))
    .toSorted((left, right) => left.label.localeCompare(right.label));
}

function groupByLabel(
  posts: readonly BoardPostRow[],
  tags: readonly BoardGroupingTag[],
  postTagsByPostId: ReadonlyMap<string, readonly string[]>
): BoardPostLane[] {
  const tagNames = new Map(tags.map((tag) => [tag.id, tag.name]));

  const postsWithTags = posts.map((post) => ({
    post,
    tagIds: (postTagsByPostId.get(post.id) ?? []).filter((tagId) =>
      tagNames.has(tagId)
    ),
  }));

  const byTag = Map.groupBy(
    postsWithTags.flatMap(({ post, tagIds }) =>
      tagIds.map((tagId) => ({ post, tagId }))
    ),
    (entry) => entry.tagId
  );

  const lanes = [...byTag.entries()]
    .toSorted((left, right) =>
      (tagNames.get(left[0]) ?? "").localeCompare(tagNames.get(right[0]) ?? "")
    )
    .map(([id, entries]) => ({
      id,
      label: tagNames.get(id) ?? "",
      posts: entries.map((entry) => entry.post),
    }));

  const noLabel = postsWithTags.flatMap(({ post, tagIds }) =>
    tagIds.length === 0 ? [post] : []
  );

  if (noLabel.length > 0) {
    lanes.push({ id: "no-label", label: "No label", posts: noLabel });
  }

  return lanes;
}
