import type { TBoard } from "@feeblo/domain/board/schema";
import type { TPostStatus } from "@feeblo/domain/post-status/schema";
import type { TPostListItem } from "@feeblo/domain/post/schema";
import { createContext, use } from "react";

import type { HomePageSortOption } from "../../hooks/use-home-page-filters";

export type HomeFilterItem = {
  count: number;
  label: string;
  value: string;
};

export type HomePost = {
  board: TBoard;
  post: TPostListItem;
  status: Pick<TPostStatus, "color" | "label" | "type">;
};

export type HomeFilters = {
  board?: string;
  sort?: HomePageSortOption;
  status?: string;
};

export type HomeState = {
  activeBoardId: string;
  activeBoardLabel: string;
  boardItems: HomeFilterItem[];
  filteredPosts: HomePost[];
  isError: boolean;
  isLoading: boolean;
  normalizedSearch: string;
  search: string;
  searchFocused: boolean;
  selectedBoard: string;
  selectedStatus: string;
  sortBy: HomePageSortOption;
  statusItems: HomeFilterItem[];
};

export type HomeActions = {
  openGiveFeedback: () => void;
  setSearch: (value: string) => void;
  setSearchFocused: (focused: boolean) => void;
  updateFilters: (filters: HomeFilters) => void;
};

export type HomeMeta = {
  organizationId: string;
};

export type HomeContextValue = {
  actions: HomeActions;
  meta: HomeMeta;
  state: HomeState;
};

export const HomeContext = createContext<HomeContextValue | null>(null);

export function useHome(): HomeContextValue {
  const value = use(HomeContext);

  if (!value) {
    throw new Error("Home components must be used within <Home.Provider>");
  }

  return value;
}
