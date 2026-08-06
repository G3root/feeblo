import type {
  RoadmapColumnDefinition,
  RoadmapLane,
  RoadmapPost,
} from "./types";

export function formatRoadmapPostDate(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Recently";
  }

  return date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  });
}

export function groupRoadmapPostsByStatus<TPost extends RoadmapPost>(
  posts: readonly TPost[],
  orderedColumns: readonly RoadmapColumnDefinition[]
) {
  const map = new Map<string, RoadmapLane<TPost>>(
    orderedColumns.map((column) => [
      column.statusId,
      {
        name: column.name,
        posts: [],
        status: column.type,
        statusId: column.statusId,
      },
    ])
  );

  for (const post of posts) {
    const existing = map.get(post.statusId);

    // Posts whose status has no configured column stay off the roadmap
    // instead of surfacing as an implicit extra lane.
    if (existing) {
      existing.posts.push(post);
    }
  }

  return [...map.values()];
}
