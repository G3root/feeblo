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
  const map = new Map<
    string,
    {
      label: string;
      posts: BoardPostRow[];
      status: BoardPostStatus;
      statusId: string;
    }
  >(
    orderedStatuses.map((status) => [
      status.id,
      {
        label: status.label,
        posts: [],
        status: status.type,
        statusId: status.id,
      },
    ])
  );

  for (const post of posts) {
    const existing = map.get(post.statusId);

    if (existing) {
      existing.posts.push(post);
      continue;
    }

    map.set(post.statusId, {
      label: "",
      posts: [post],
      status: post.status,
      statusId: post.statusId,
    });
  }

  const lanes: BoardPostLane[] = [];
  for (const lane of map.values()) {
    if (lane.posts.length === 0) {
      continue;
    }
    lanes.push({
      id: lane.statusId,
      label: lane.label,
      posts: lane.posts,
      status: lane.status,
      statusId: lane.statusId,
    });
  }

  return lanes;
}

function groupByAssignee(
  posts: readonly BoardPostRow[],
  members: readonly BoardGroupingMember[]
): BoardPostLane[] {
  const byMember = new Map<string, BoardPostRow[]>();
  const unassigned: BoardPostRow[] = [];

  for (const post of posts) {
    if (post.assigneeMemberId === null) {
      unassigned.push(post);
      continue;
    }

    const memberPosts = byMember.get(post.assigneeMemberId);

    if (memberPosts) {
      memberPosts.push(post);
    } else {
      byMember.set(post.assigneeMemberId, [post]);
    }
  }

  const lanes: BoardPostLane[] = [];
  for (const member of members) {
    const memberPosts = byMember.get(member.id);

    if (memberPosts?.length) {
      lanes.push({ id: member.id, label: member.name, posts: memberPosts });
      byMember.delete(member.id);
    }
  }

  // A post can name a member row this page has not loaded yet. Keeping the
  // posts under the id is better than dropping them; the name is the only
  // thing missing.
  for (const [memberId, memberPosts] of byMember) {
    lanes.push({ id: memberId, label: "Unknown member", posts: memberPosts });
  }

  if (unassigned.length > 0) {
    lanes.push({ id: "unassigned", label: "Unassigned", posts: unassigned });
  }

  return lanes;
}

function groupByBoard(posts: readonly BoardPostRow[]): BoardPostLane[] {
  const byBoard = new Map<string, { label: string; posts: BoardPostRow[] }>();

  for (const post of posts) {
    const board = byBoard.get(post.boardId);

    if (board) {
      board.posts.push(post);
    } else {
      byBoard.set(post.boardId, {
        label: post.boardName || "No board",
        posts: [post],
      });
    }
  }

  return [...byBoard.entries()]
    .toSorted((left, right) => left[1].label.localeCompare(right[1].label))
    .map(([id, board]) => ({
      id,
      label: board.label,
      posts: board.posts,
    }));
}

function groupByLabel(
  posts: readonly BoardPostRow[],
  tags: readonly BoardGroupingTag[],
  postTagsByPostId: ReadonlyMap<string, readonly string[]>
): BoardPostLane[] {
  const tagNames = new Map(tags.map((tag) => [tag.id, tag.name]));
  const byTag = new Map<string, BoardPostRow[]>();
  const noLabel: BoardPostRow[] = [];

  for (const post of posts) {
    const tagIds = postTagsByPostId.get(post.id) ?? [];
    const resolvedTagIds = tagIds.filter((tagId) => tagNames.has(tagId));

    if (resolvedTagIds.length === 0) {
      noLabel.push(post);
      continue;
    }

    for (const tagId of resolvedTagIds) {
      const tagPosts = byTag.get(tagId);

      if (tagPosts) {
        tagPosts.push(post);
      } else {
        byTag.set(tagId, [post]);
      }
    }
  }

  const lanes = [...byTag.entries()]
    .toSorted((left, right) =>
      (tagNames.get(left[0]) ?? "").localeCompare(tagNames.get(right[0]) ?? "")
    )
    .map(([id, tagPosts]) => ({
      id,
      label: tagNames.get(id) ?? "",
      posts: tagPosts,
    }));

  if (noLabel.length > 0) {
    lanes.push({ id: "no-label", label: "No label", posts: noLabel });
  }

  return lanes;
}
