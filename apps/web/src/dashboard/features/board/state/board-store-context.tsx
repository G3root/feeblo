import {
  DEFAULT_BOARD_GROUPING,
  emptyBoardQuery,
  normalizeBoardFilters,
} from "@feeblo/domain-contracts/board-query";
import type {
  TBoardFilters,
  TBoardGroupBy,
  TBoardGrouping,
  TBoardOrderDirection,
  TBoardOrderField,
  TBoardOrdering,
  TBoardStatusOperator,
  TBoardTagOperator,
} from "@feeblo/domain-contracts/board-query";
import { createStoreContext } from "@feeblo/web-shared/xstate";
import { createStore } from "@xstate/store";
import { useSelector } from "@xstate/store-react";

/**
 * The board's filter vocabulary is the persisted one.
 *
 * A saved view stores exactly what this store holds, so the two cannot be
 * allowed to drift into near-identical types with different field names: the
 * store derives its state from `@feeblo/domain-contracts/board-query`, and
 * `setActiveView` accepts a stored query with no translation.
 */
export type BoardDisplayMode = "list" | "grid";
export type BoardGroupBy = TBoardGroupBy;
export type BoardGrouping = TBoardGrouping;
export type BoardOrderDirection = TBoardOrderDirection;
export type BoardOrderField = TBoardOrderField;
export type BoardOrdering = TBoardOrdering;
export type BoardStatusOperator = TBoardStatusOperator;
export type BoardTagOperator = TBoardTagOperator;
export type BoardFilters = TBoardFilters;

const DEFAULT_ORDERING: BoardOrdering = {
  direction: "desc",
  field: "createdAt",
};

const DEFAULT_GROUPING: BoardGrouping = { ...DEFAULT_BOARD_GROUPING };

export type BoardView = {
  filters: BoardFilters;
  id: string;
  name: string;
};

export type SelectedBoardPost = {
  boardId: string;
  postId: string;
};

type BoardStoreContext = {
  activeView: BoardView;
  boardId?: string;
  bulkDeleteOpen: boolean;
  displayMode: BoardDisplayMode;
  grouping: BoardGrouping;
  ordering: BoardOrdering;
  selectedPosts: SelectedBoardPost[];
};

export type BoardStoreDefaultValue = {
  activeView: BoardView;
  boardId?: string;
  displayMode?: BoardDisplayMode;
  grouping?: BoardGrouping;
  ordering?: BoardOrdering;
};

/**
 * The filter set a board starts with: every dimension off.
 *
 * A function rather than a shared constant so two boards mounted at once never
 * hold the same filter objects — every event replaces them rather than mutating
 * them, but a future event that did mutate would silently reach across boards.
 */
const defaultBoardFilters = (): BoardFilters =>
  normalizeBoardFilters(emptyBoardQuery.filters);

const createBoardStore = (defaultValue?: BoardStoreDefaultValue) =>
  createStore({
    // SAFETY: `createStore` infers its event payload map from this object, and a
    // `satisfies` on it widens every handler's event to `EventObject`, which
    // makes the events untyped at every `store.send` call site. The assertion
    // keeps the context shape checked against `BoardStoreContext` without giving
    // up the per-event payload inference.
    context: {
      activeView: defaultValue?.activeView ?? {
        id: "all-feedback",
        name: "All feedbacks",
        filters: defaultBoardFilters(),
      },
      boardId: defaultValue?.boardId ?? "",
      bulkDeleteOpen: false,
      displayMode: defaultValue?.displayMode ?? "list",
      grouping: defaultValue?.grouping ?? DEFAULT_GROUPING,
      ordering: defaultValue?.ordering ?? DEFAULT_ORDERING,
      selectedPosts: [],
    } as BoardStoreContext,
    on: {
      clearSelection: (context) => ({
        ...context,
        selectedPosts: [],
      }),
      setActiveView: (
        context,
        event: {
          grouping?: BoardGrouping;
          ordering?: BoardOrdering;
          view: BoardView;
        }
      ) => ({
        ...context,
        activeView: {
          ...event.view,
          filters: normalizeBoardFilters(event.view.filters),
        },
        ...(event.grouping !== undefined && { grouping: event.grouping }),
        ...(event.ordering !== undefined && { ordering: event.ordering }),
        selectedPosts: [],
      }),
      setBulkDeleteOpen: (context, event: { open: boolean }) => ({
        ...context,
        bulkDeleteOpen: event.open,
      }),
      setDisplayMode: (context, event: { mode: BoardDisplayMode }) => ({
        ...context,
        displayMode: event.mode,
      }),
      setFilters: (context, event: { filters: BoardFilters }) => ({
        ...context,
        activeView: {
          ...context.activeView,
          filters: normalizeBoardFilters(event.filters),
        },
      }),
      setGroupBy: (context, event: { field: BoardGroupBy }) => ({
        ...context,
        grouping: { field: event.field },
      }),
      setOrderField: (context, event: { field: BoardOrderField }) => ({
        ...context,
        ordering: {
          ...context.ordering,
          field: event.field,
        },
      }),
      toggleOrderDirection: (context) => {
        const direction: BoardOrderDirection =
          context.ordering.direction === "asc" ? "desc" : "asc";

        return {
          ...context,
          ordering: {
            ...context.ordering,
            direction,
          },
        };
      },
      syncAvailablePostIds: (context, event: { postIds: string[] }) => {
        const available = new Set(event.postIds);
        return {
          ...context,
          selectedPosts: context.selectedPosts.filter(({ postId }) =>
            available.has(postId)
          ),
        };
      },
      deselectPosts: (context, event: { postIds: string[] }) => {
        const idsToRemove = new Set(event.postIds);
        return {
          ...context,
          selectedPosts: context.selectedPosts.filter(
            ({ postId }) => !idsToRemove.has(postId)
          ),
        };
      },
      selectPosts: (context, event: { posts: SelectedBoardPost[] }) => {
        const selected = new Map(
          context.selectedPosts.map((entry) => [entry.postId, entry])
        );

        for (const post of event.posts) {
          selected.set(post.postId, post);
        }

        return {
          ...context,
          selectedPosts: [...selected.values()],
        };
      },
      togglePostSelection: (
        context,
        event: { boardId: string; checked?: boolean; postId: string }
      ) => {
        const selected = new Map(
          context.selectedPosts.map((entry) => [entry.postId, entry])
        );
        const isSelected = selected.has(event.postId);
        const shouldSelect = event.checked ?? !isSelected;

        if (shouldSelect) {
          selected.set(event.postId, {
            boardId: event.boardId,
            postId: event.postId,
          });
        } else {
          selected.delete(event.postId);
        }

        return {
          ...context,
          selectedPosts: [...selected.values()],
        };
      },
    },
  });

export const [BoardStoreProvider, useBoardStore] = createStoreContext<
  ReturnType<typeof createBoardStore>,
  BoardStoreDefaultValue
>({
  createStore: createBoardStore,
  hookName: "useBoardStore",
  name: "BoardStoreContext",
  providerName: "BoardStoreProvider",
});

export function useSelectedPosts() {
  const store = useBoardStore();
  return useSelector(store, (state) => state.context.selectedPosts);
}

export function useSelectedPostIds() {
  const selectedPosts = useSelectedPosts();
  return selectedPosts.map((post) => post.postId);
}

export function useBoardDisplayMode() {
  const store = useBoardStore();
  return useSelector(store, (state) => state.context.displayMode);
}

export function useBoardOrdering() {
  const store = useBoardStore();
  return useSelector(store, (state) => state.context.ordering);
}

export function useBoardGrouping() {
  const store = useBoardStore();
  return useSelector(store, (state) => state.context.grouping);
}

export function useActiveBoardView() {
  const store = useBoardStore();
  return useSelector(store, (state) => state.context.activeView);
}
