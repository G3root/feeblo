import type { TBoard } from "@feeblo/domain/board/schema";
import type { TPost } from "@feeblo/domain/post/schema";
import type { TPostStatus } from "@feeblo/domain/post-status/schema";
import type { TRoadmap } from "@feeblo/domain/roadmap/schema";
import type { TStatusRoadmapColumn } from "@feeblo/domain/roadmap-column/schema";
import type { Collection, UtilsRecord } from "@tanstack/db";
import { and, eq, useLiveQuery } from "@tanstack/react-db";
import { useCallback, useMemo } from "react";
import type {
  RoadmapBoardPost,
  RoadmapColumnDefinition,
  RoadmapLane,
} from "./types";
import { groupRoadmapPostsByStatus } from "./utils";

type BoardRowLike = Pick<TBoard, "id" | "name" | "organizationId" | "slug">;

type PostRowLike = Pick<
  TPost,
  | "boardId"
  | "createdAt"
  | "excerpt"
  | "id"
  | "organizationId"
  | "slug"
  | "statusId"
  | "title"
  | "updatedAt"
>;

type PostStatusRowLike = Pick<TPostStatus, "id" | "organizationId" | "type">;

type RoadmapRowLike = Pick<
  TRoadmap,
  | "createdAt"
  | "description"
  | "id"
  | "mode"
  | "name"
  | "organizationId"
  | "slug"
>;

type RoadmapColumnRowLike = Pick<
  TStatusRoadmapColumn,
  "id" | "name" | "position" | "roadmapId" | "statusId"
>;

export type RoadmapCollections<
  TBoardRow extends BoardRowLike = BoardRowLike,
  TPostRow extends PostRowLike = PostRowLike,
  TPostStatusRow extends PostStatusRowLike = PostStatusRowLike,
  TRoadmapRow extends RoadmapRowLike = RoadmapRowLike,
  TRoadmapColumnRow extends RoadmapColumnRowLike = RoadmapColumnRowLike,
> = {
  boardCollection: Collection<TBoardRow, string, UtilsRecord>;
  postCollection: Collection<TPostRow, string, UtilsRecord>;
  postStatusCollection: Collection<TPostStatusRow, string, UtilsRecord>;
  roadmapCollection: Collection<TRoadmapRow, string, UtilsRecord>;
  roadmapColumnCollection: Collection<TRoadmapColumnRow, string, UtilsRecord>;
};

export type UseRoadmapDataOptions<
  TBoardRow extends BoardRowLike = BoardRowLike,
  TPostRow extends PostRowLike = PostRowLike,
  TPostStatusRow extends PostStatusRowLike = PostStatusRowLike,
  TRoadmapRow extends RoadmapRowLike = RoadmapRowLike,
  TRoadmapColumnRow extends RoadmapColumnRowLike = RoadmapColumnRowLike,
> = RoadmapCollections<
  TBoardRow,
  TPostRow,
  TPostStatusRow,
  TRoadmapRow,
  TRoadmapColumnRow
> & {
  organizationId: string | undefined;
  /**
   * When provided, only the roadmap matching this slug is queried.
   * When omitted, all status-mode roadmaps are queried.
   */
  slug?: string;
};

export type RoadmapSummary = {
  description: string | null;
  id: string;
  name: string;
  slug: string;
};

export type UseRoadmapDataResult = {
  roadmaps: RoadmapSummary[];
  allRoadmaps: RoadmapSummary[];
  columns: RoadmapColumnDefinition[];
  posts: RoadmapBoardPost[];
  isError: boolean;
  isLoading: boolean;
  lanesFor: (roadmapId: string) => RoadmapLane<RoadmapBoardPost>[];
};

export function useRoadmapData<
  TBoardRow extends BoardRowLike = BoardRowLike,
  TPostRow extends PostRowLike = PostRowLike,
  TPostStatusRow extends PostStatusRowLike = PostStatusRowLike,
  TRoadmapRow extends RoadmapRowLike = RoadmapRowLike,
  TRoadmapColumnRow extends RoadmapColumnRowLike = RoadmapColumnRowLike,
>({
  boardCollection,
  postCollection,
  postStatusCollection,
  roadmapCollection,
  roadmapColumnCollection,
  organizationId,
  slug,
}: UseRoadmapDataOptions<
  TBoardRow,
  TPostRow,
  TPostStatusRow,
  TRoadmapRow,
  TRoadmapColumnRow
>): UseRoadmapDataResult {
  const roadmapsQuery = useLiveQuery(
    (q) => {
      if (!organizationId) {
        return undefined;
      }

      return q
        .from({ roadmap: roadmapCollection })
        .where(({ roadmap }) =>
          and(
            eq(roadmap.organizationId, organizationId),
            slug === undefined
              ? eq(roadmap.mode, "status")
              : eq(roadmap.slug, slug)
          )
        )
        .select(({ roadmap }) => ({
          description: roadmap.description,
          id: roadmap.id,
          name: roadmap.name,
          slug: roadmap.slug,
        }))
        .orderBy(({ roadmap }) => roadmap.createdAt, "asc");
    },
    [organizationId, slug]
  );

  const allRoadmapsQuery = useLiveQuery(
    (q) => {
      if (!organizationId || slug === undefined) {
        return undefined;
      }

      return q
        .from({ roadmap: roadmapCollection })
        .where(({ roadmap }) =>
          and(
            eq(roadmap.organizationId, organizationId),
            eq(roadmap.mode, "status")
          )
        )
        .select(({ roadmap }) => ({
          description: roadmap.description,
          id: roadmap.id,
          name: roadmap.name,
          slug: roadmap.slug,
        }))
        .orderBy(({ roadmap }) => roadmap.createdAt, "asc");
    },
    [organizationId, slug]
  );

  const columnsQuery = useLiveQuery(
    (q) => {
      if (!organizationId) {
        return undefined;
      }

      return q
        .from({ column: roadmapColumnCollection })
        .join(
          { postStatus: postStatusCollection },
          ({ column, postStatus }) => eq(column.statusId, postStatus.id),
          "inner"
        )
        .join(
          { roadmap: roadmapCollection },
          ({ column, roadmap }) => eq(column.roadmapId, roadmap.id),
          "inner"
        )
        .where(({ postStatus, roadmap }) =>
          and(
            eq(postStatus.organizationId, organizationId),
            eq(roadmap.organizationId, organizationId)
          )
        )
        .select(({ column, postStatus }) => ({
          id: column.id,
          name: column.name,
          roadmapId: column.roadmapId,
          statusId: postStatus.id,
          type: postStatus.type,
        }))
        .orderBy(({ column }) => column.position, "asc");
    },
    [organizationId]
  );

  const postsQuery = useLiveQuery(
    (q) => {
      if (!organizationId) {
        return undefined;
      }

      return q
        .from({ post: postCollection })
        .join(
          { postStatus: postStatusCollection },
          ({ post, postStatus }) => eq(post.statusId, postStatus.id),
          "inner"
        )
        .join(
          { board: boardCollection },
          ({ post, board }) => eq(post.boardId, board.id),
          "inner"
        )
        .where(({ board, post, postStatus }) =>
          and(
            eq(post.organizationId, organizationId),
            eq(postStatus.organizationId, organizationId),
            eq(board.organizationId, organizationId)
          )
        )
        .select(({ board, post, postStatus }) => ({
          boardName: board.name,
          boardSlug: board.slug,
          id: post.id,
          slug: post.slug,
          status: postStatus.type,
          statusId: post.statusId,
          summary: post.excerpt,
          title: post.title,
          updatedAt: post.updatedAt,
        }))
        .orderBy(({ post }) => post.createdAt, "desc");
    },
    [organizationId]
  );

  const isError =
    roadmapsQuery.isError ||
    allRoadmapsQuery.isError ||
    columnsQuery.isError ||
    postsQuery.isError;
  const isLoading =
    roadmapsQuery.isLoading ||
    allRoadmapsQuery.isLoading ||
    columnsQuery.isLoading ||
    postsQuery.isLoading;

  const lanesByRoadmap = useMemo(() => {
    const posts = postsQuery.data ?? [];
    const columns = columnsQuery.data ?? [];
    const map = new Map<string, RoadmapLane<RoadmapBoardPost>[]>();

    for (const roadmapId of new Set(
      columns.map((column) => column.roadmapId)
    )) {
      map.set(
        roadmapId,
        groupRoadmapPostsByStatus(
          posts,
          columns.filter((column) => column.roadmapId === roadmapId)
        )
      );
    }

    return map;
  }, [postsQuery.data, columnsQuery.data]);

  const lanesFor = useCallback(
    (roadmapId: string) => lanesByRoadmap.get(roadmapId) ?? [],
    [lanesByRoadmap]
  );

  return useMemo(
    () => ({
      roadmaps: roadmapsQuery.data ?? [],
      allRoadmaps:
        slug === undefined
          ? (roadmapsQuery.data ?? [])
          : (allRoadmapsQuery.data ?? []),
      columns: columnsQuery.data ?? [],
      posts: postsQuery.data ?? [],
      isError,
      isLoading,
      lanesFor,
    }),
    [
      roadmapsQuery.data,
      allRoadmapsQuery.data,
      columnsQuery.data,
      postsQuery.data,
      isError,
      isLoading,
      lanesFor,
      slug,
    ]
  );
}
