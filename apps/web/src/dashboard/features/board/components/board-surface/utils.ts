import type { BoardPostStatus } from "@feeblo/web-shared/board/constants";
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
  orderedStatuses: ReadonlyArray<{
    id: string;
    type: BoardPostStatus;
  }>
) => {
  const map = new Map<
    string,
    {
      posts: BoardPostRow[];
      status: BoardPostStatus;
      statusId: string;
    }
  >(
    orderedStatuses.map((status) => [
      status.id,
      {
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
      posts: [post],
      status: post.status,
      statusId: post.statusId,
    });
  }

  return [...map.entries()]
    .filter(([, lane]) => lane.posts.length > 0)
    .map(
      ([, lane]): BoardPostLane => ({
        status: lane.status,
        statusId: lane.statusId,
        posts: lane.posts,
      })
    );
};
