import {
  useAuthDialogContext,
  usePostCreateDialogContext,
} from "@feeblo/post-ui/dialog-stores";
import { useAuthState } from "@feeblo/web-shared/use-auth-state";
import {
  and,
  coalesce,
  count,
  eq,
  ilike,
  or,
  useLiveQuery,
} from "@tanstack/react-db";
import { type ReactNode, useMemo, useState } from "react";

import { useHomePageFilters } from "../../hooks/use-home-page-filters";
import { formatPostStatus } from "../../lib/utils";
import { usePublicCollections } from "../../providers/public-collections-provider";
import { useSite } from "../../providers/site-provider";
import {
  HomeContext,
  type HomeContextValue,
  type HomePost,
} from "./home-context";

export function HomeProvider({ children }: { children: ReactNode }) {
  const { data: session } = useAuthState();
  const postCreateStore = usePostCreateDialogContext();
  const authDialogStore = useAuthDialogContext();
  const site = useSite();
  const [search, setSearch] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const normalizedSearch = search.trim();

  const organizationId = site.organizationId;
  const {
    publicBoardCollection,
    publicPostCollection,
    publicPostStatusCollection,
    publicUpvoteCollection,
  } = usePublicCollections();

  const {
    data: statuses = [],
    isError: statusError,
    isLoading: statusLoading,
  } = useLiveQuery(
    (q) =>
      q
        .from({ status: publicPostStatusCollection })
        .where(({ status }) => eq(status.organizationId, site.organizationId)),
    [site.organizationId]
  );

  const {
    data: boards = [],
    isError: boardError,
    isLoading: boardLoading,
  } = useLiveQuery(
    (q) =>
      q
        .from({ board: publicBoardCollection })
        .where(({ board }) => eq(board.organizationId, site.organizationId))
        .orderBy(({ board }) => board.name, "asc"),
    [site.organizationId]
  );

  const { data: statusCounts = [] } = useLiveQuery(
    (q) =>
      q
        .from({ post: publicPostCollection })
        .where(({ post }) => eq(post.organizationId, site.organizationId))
        .groupBy(({ post }) => post.statusId)
        .select(({ post }) => ({
          statusId: post.statusId,
          count: count(post.id),
        })),
    [site.organizationId]
  );

  const { data: boardCounts = [] } = useLiveQuery(
    (q) =>
      q
        .from({ post: publicPostCollection })
        .where(({ post }) => eq(post.organizationId, site.organizationId))
        .groupBy(({ post }) => post.boardId)
        .select(({ post }) => ({
          boardId: post.boardId,
          count: count(post.id),
        })),
    [site.organizationId]
  );

  const { selectedBoard, selectedStatus, sortBy, updateFilters } =
    useHomePageFilters({
      boardSlugs: boards.map((board) => board.slug),
      statusIds: statuses.map((status) => status.id),
    });

  const {
    data: filteredPosts = [],
    isError: filteredPostsError,
    isLoading: filteredPostsLoading,
  } = useLiveQuery(
    (q) => {
      if (
        !site.organizationId ||
        statusLoading ||
        boardLoading ||
        statusError ||
        boardError
      ) {
        return undefined;
      }

      const upvoteCountsSubquery = q
        .from({ upvote: publicUpvoteCollection })
        .where(({ upvote }) => eq(upvote.organizationId, site.organizationId))
        .groupBy(({ upvote }) => upvote.postId)
        .select(({ upvote }) => ({
          postId: upvote.postId,
          upvoteCount: count(upvote.id),
        }));

      const query = q
        .from({ post: publicPostCollection })
        .join(
          { board: publicBoardCollection },
          ({ post, board }) => eq(board.id, post.boardId),
          "inner"
        )
        .join(
          { status: publicPostStatusCollection },
          ({ post, status }) => eq(status.id, post.statusId),
          "inner"
        )
        .leftJoin(
          { upvoteCounts: upvoteCountsSubquery },
          ({ post, upvoteCounts }) => eq(post.id, upvoteCounts.postId)
        )
        .where(({ post, board, status }) => {
          let condition = and(
            eq(post.organizationId, site.organizationId),
            eq(board.organizationId, site.organizationId),
            eq(status.organizationId, site.organizationId)
          );

          if (selectedBoard !== "all") {
            condition = and(condition, eq(board.slug, selectedBoard));
          }

          if (selectedStatus !== "all") {
            condition = and(condition, eq(status.id, selectedStatus));
          }

          if (normalizedSearch) {
            condition = and(
              condition,
              or(
                ilike(post.title, `%${normalizedSearch}%`),
                ilike(post.excerpt, `%${normalizedSearch}%`)
              )
            );
          }

          return condition;
        });

      const projectedQuery = query.select(
        ({ post, board, status, upvoteCounts }) => ({
          board: {
            ...board,
          },
          post: {
            ...post,
          },
          status: {
            type: status.type,
            label: status.label,
            color: status.color,
          },
          createdAt: post.createdAt,
          upvoteCount: coalesce(upvoteCounts.upvoteCount, 0),
        })
      );

      if (sortBy === "upvotes") {
        return projectedQuery.orderBy(
          ({ $selected }) => $selected.upvoteCount,
          "desc"
        );
      }

      if (sortBy === "newest") {
        return projectedQuery.orderBy(
          ({ $selected }) => $selected.createdAt,
          "desc"
        );
      }

      if (sortBy === "oldest") {
        return projectedQuery.orderBy(
          ({ $selected }) => $selected.createdAt,
          "asc"
        );
      }

      return projectedQuery;
    },
    [
      site.organizationId,
      statusLoading,
      boardLoading,
      statusError,
      boardError,
      selectedBoard,
      selectedStatus,
      sortBy,
      normalizedSearch,
    ]
  );

  const statusItems = useMemo(() => {
    const countMap = new Map(statusCounts.map((s) => [s.statusId, s.count]));
    const totalPosts = statusCounts.reduce((sum, s) => sum + s.count, 0);

    return [
      { count: totalPosts, label: "All statuses", value: "all" },
      ...statuses.map((status) => ({
        count: countMap.get(status.id) ?? 0,
        label: status.label || formatPostStatus(status.type),
        value: status.id,
      })),
    ];
  }, [statusCounts, statuses]);

  const boardItems = useMemo(() => {
    const countMap = new Map<string, number>();
    const boardsById = new Map(boards.map((board) => [board.id, board]));

    for (const bc of boardCounts) {
      const board = boardsById.get(bc.boardId);
      if (!board) {
        continue;
      }
      countMap.set(board.slug, (countMap.get(board.slug) ?? 0) + bc.count);
    }

    const totalPosts = boardCounts.reduce((sum, b) => sum + b.count, 0);

    return [
      { count: totalPosts, label: "All boards", value: "all" },
      ...boards.map((board) => ({
        count: countMap.get(board.slug) ?? 0,
        label: board.name,
        value: board.slug,
      })),
    ];
  }, [boardCounts, boards]);

  const activeBoardLabel =
    boardItems.find((item) => item.value === selectedBoard)?.label ??
    "All boards";
  const activeBoardId =
    selectedBoard === "all"
      ? ""
      : (boards.find((board) => board.slug === selectedBoard)?.id ?? "");

  const isLoading = statusLoading || boardLoading || filteredPostsLoading;
  const isError = statusError || boardError || filteredPostsError;

  const openGiveFeedback = () => {
    if (session) {
      postCreateStore.send({
        type: "toggle",
        data: {
          boardId: activeBoardId,
          source: "public_portal",
        },
      });
    } else {
      authDialogStore.send({
        type: "setOpen",
        open: true,
        data: { variant: "sign-in" },
      });
    }
  };

  const value: HomeContextValue = {
    actions: {
      openGiveFeedback,
      setSearch,
      setSearchFocused,
      updateFilters,
    },
    meta: { organizationId },
    state: {
      activeBoardId,
      activeBoardLabel,
      boardItems,
      // SAFETY: The runtime invariant checked by the surrounding code guarantees this type.
      filteredPosts: filteredPosts as HomePost[],
      isError,
      isLoading,
      normalizedSearch,
      search,
      searchFocused,
      selectedBoard,
      selectedStatus,
      sortBy,
      statusItems,
    },
  };

  return <HomeContext value={value}>{children}</HomeContext>;
}
