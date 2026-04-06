import type { BoardPostStatus } from "../../constants";
import type { BoardPostLane, BoardPostRow } from "./types";

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

export const groupPostsByStatus = (
  posts: BoardPostRow[],
  orderedStatuses: readonly BoardPostStatus[]
) => {
  const map = new Map<BoardPostStatus, BoardPostRow[]>(
    orderedStatuses.map((status) => [status, []])
  );

  for (const post of posts) {
    const existing = map.get(post.status);

    if (existing) {
      existing.push(post);
      continue;
    }

    map.set(post.status, [post]);
  }

  return [...map.entries()].map(
    ([status, groupedPosts]): BoardPostLane => ({
      status,
      posts: groupedPosts,
    })
  );
};
