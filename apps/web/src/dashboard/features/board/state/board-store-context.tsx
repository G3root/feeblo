import { emptyBoardQuery } from "@feeblo/domain-contracts/board-query";
import type {
  TBoardFilters,
  TBoardOrderDirection,
  TBoardOrderField,
  TBoardOrdering,
  TBoardPostStatusFilter,
  TBoardStatusOperator,
  TBoardTagOperator,
} from "@feeblo/domain-contracts/board-query";
import { type BoardPostStatus } from "@feeblo/web-shared/board/constants";
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
export type BoardOrderDirection = TBoardOrderDirection;
export type BoardOrderField = TBoardOrderField;
export type BoardOrdering = TBoardOrdering;
export type BoardPostStatusFilter = TBoardPostStatusFilter;
export type BoardStatusOperator = TBoardStatusOperator;
export type BoardTagOperator = TBoardTagOperator;
export type BoardFilters = TBoardFilters;

const DEFAULT_STATUS_OPERATOR: BoardStatusOperator = "isAnyOf";
const DEFAULT_TAG_OPERATOR: BoardTagOperator = "includeAllOf";
const DEFAULT_ORDERING: BoardOrdering = {
  direction: "desc",
  field: "createdAt",
};

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
  ordering: BoardOrdering;
  selectedPosts: SelectedBoardPost[];
};

export type BoardStoreDefaultValue = {
  activeView: BoardView;
  boardId?: string;
  displayMode?: BoardDisplayMode;
  ordering?: BoardOrdering;
};

/**
 * The filter set a board starts with: nothing selected, both operators at their
 * neutral value, and the "all statuses" preset.
 *
 * A function rather than a shared constant so two boards mounted at once never
 * hold the same filter objects — every event replaces them rather than mutating
 * them, but a future event that did mutate would silently reach across boards.
 */
const defaultBoardFilters = (): BoardFilters => ({
  ...emptyBoardQuery.filters,
  // Copied rather than shared: the constants on `emptyBoardQuery` are
  // module-level, and two mounted boards must not be able to reach one array.
  assigneeMemberIds: [...emptyBoardQuery.filters.assigneeMemberIds],
  statuses: [...emptyBoardQuery.filters.statuses],
  tagIds: [...emptyBoardQuery.filters.tagIds],
});

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
        event: { ordering?: BoardOrdering; view: BoardView }
      ) => ({
        ...context,
        activeView: event.view,
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
      clearFilters: (context) => ({
        ...context,
        activeView: {
          ...context.activeView,
          filters: {
            ...context.activeView.filters,
            assigneeMemberIds: [],
            search: "",
            statusOperator: DEFAULT_STATUS_OPERATOR,
            statuses: [],
            tagIds: [],
            tagOperator: DEFAULT_TAG_OPERATOR,
          },
        },
      }),
      setSearch: (context, event: { value: string }) => ({
        ...context,
        activeView: {
          ...context.activeView,
          filters: {
            ...context.activeView.filters,
            search: event.value,
          },
        },
      }),
      setTagOperator: (context, event: { operator: BoardTagOperator }) => ({
        ...context,
        activeView: {
          ...context.activeView,
          filters: {
            ...context.activeView.filters,
            tagOperator: event.operator,
          },
        },
      }),
      setStatusOperator: (
        context,
        event: { operator: BoardStatusOperator }
      ) => ({
        ...context,
        activeView: {
          ...context.activeView,
          filters: {
            ...context.activeView.filters,
            statusOperator: event.operator,
          },
        },
      }),
      toggleTagFilter: (context, event: { tagId: string }) => {
        const tagIds = new Set(context.activeView.filters.tagIds);

        if (tagIds.has(event.tagId)) {
          tagIds.delete(event.tagId);
        } else {
          tagIds.add(event.tagId);
        }

        return {
          ...context,
          activeView: {
            ...context.activeView,
            filters: {
              ...context.activeView.filters,
              tagIds: [...tagIds],
            },
          },
        };
      },
      toggleStatusFilter: (context, event: { status: BoardPostStatus }) => {
        const statuses = new Set(context.activeView.filters.statuses);

        if (statuses.has(event.status)) {
          statuses.delete(event.status);
        } else {
          statuses.add(event.status);
        }

        return {
          ...context,
          activeView: {
            ...context.activeView,
            filters: {
              ...context.activeView.filters,
              statuses: [...statuses],
            },
          },
        };
      },
      toggleAssigneeFilter: (context, event: { memberId: string }) => {
        const assigneeMemberIds = new Set(
          context.activeView.filters.assigneeMemberIds
        );

        if (assigneeMemberIds.has(event.memberId)) {
          assigneeMemberIds.delete(event.memberId);
        } else {
          assigneeMemberIds.add(event.memberId);
        }

        return {
          ...context,
          activeView: {
            ...context.activeView,
            filters: {
              ...context.activeView.filters,
              assigneeMemberIds: [...assigneeMemberIds],
            },
          },
        };
      },
      clearAssigneeFilter: (context) => ({
        ...context,
        activeView: {
          ...context.activeView,
          filters: {
            ...context.activeView.filters,
            assigneeMemberIds: [],
          },
        },
      }),
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

export function useActiveBoardView() {
  const store = useBoardStore();
  return useSelector(store, (state) => state.context.activeView);
}
