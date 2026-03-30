import type { BoardPostStatus } from "../../constants";
import type { BoardPostRow } from "./types";

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

export const groupPostByStatusMap = (posts: BoardPostRow[]) => {
  const map: Record<BoardPostStatus, BoardPostRow[]> = {
    PLANNED: [],
    IN_PROGRESS: [],
    REVIEW: [],
    COMPLETED: [],
    PAUSED: [],
    CLOSED: [],
  };

  for (const post of posts) {
    map[post.status].push(post);
  }

  return map;
};
