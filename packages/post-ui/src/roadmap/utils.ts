import type {
  RoadmapLane,
  RoadmapPost,
  RoadmapStatusDefinition,
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
  orderedStatuses: readonly RoadmapStatusDefinition[]
) {
  const map = new Map<string, RoadmapLane<TPost>>(
    orderedStatuses.map((status) => [
      status.id,
      {
        name: status.name,
        posts: [],
        status: status.type,
        statusId: status.id,
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
