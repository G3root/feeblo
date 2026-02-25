import { BOARD_LANES, type BoardPostStatus } from "../../constants";
import type { BoardLane } from "./types";

export function getToneForStatus(status: BoardPostStatus) {
  const lane = BOARD_LANES.find((entry) => entry.statuses.includes(status));
  return lane?.toneVar ?? "var(--muted-foreground)";
}

export function findLaneKeyByPost(lanes: BoardLane[], postSlug: string) {
  const lane = lanes.find((entry) =>
    entry.posts.some((post) => post.slug === postSlug)
  );

  return lane?.key;
}

export function movePostToLane(
  lanes: BoardLane[],
  postSlug: string,
  sourceLaneKey: string,
  targetLaneKey: string
) {
  const sourceLane = lanes.find((lane) => lane.key === sourceLaneKey);
  const targetLane = lanes.find((lane) => lane.key === targetLaneKey);

  if (!(sourceLane && targetLane)) {
    return lanes;
  }

  const post = sourceLane.posts.find((entry) => entry.slug === postSlug);

  if (!post) {
    return lanes;
  }

  return lanes.map((lane) => {
    if (lane.key === sourceLaneKey) {
      return {
        ...lane,
        posts: lane.posts.filter((entry) => entry.slug !== postSlug),
      };
    }

    if (lane.key === targetLaneKey) {
      return {
        ...lane,
        posts: [...lane.posts, post],
      };
    }

    return lane;
  });
}

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
