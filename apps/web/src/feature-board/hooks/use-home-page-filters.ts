import { getRouteApi, useNavigate } from "@tanstack/react-router";

export type HomePageSortOption = "upvotes" | "newest" | "oldest";
type FilterValue = "all" | string;

const SORT_OPTIONS: readonly HomePageSortOption[] = [
  "upvotes",
  "newest",
  "oldest",
];

const homeRouteApi = getRouteApi("/");

function normalizeFilterValue(value: string | undefined): FilterValue {
  return value?.trim() || "all";
}

function normalizeSortValue(value: string | undefined): HomePageSortOption {
  return SORT_OPTIONS.includes(value as HomePageSortOption)
    ? (value as HomePageSortOption)
    : "newest";
}

export function useHomePageFilters({
  boardSlugs,
  statusIds,
}: {
  boardSlugs: string[];
  statusIds: string[];
}) {
  const search = homeRouteApi.useSearch();
  const navigate = useNavigate();
  const selectedStatusFromUrl = normalizeFilterValue(search.status);
  const selectedBoardFromUrl = normalizeFilterValue(search.board);
  const sortBy = normalizeSortValue(search.sort);

  const selectedStatus =
    selectedStatusFromUrl === "all" || statusIds.includes(selectedStatusFromUrl)
      ? selectedStatusFromUrl
      : "all";

  const selectedBoard =
    selectedBoardFromUrl === "all" || boardSlugs.includes(selectedBoardFromUrl)
      ? selectedBoardFromUrl
      : "all";

  const updateFilters = ({
    board = selectedBoard,
    sort = sortBy,
    status = selectedStatus,
  }: {
    board?: FilterValue;
    sort?: HomePageSortOption;
    status?: FilterValue;
  }) => {
    const nextSearch: Record<string, string | undefined> = {};

    if (status !== "all") {
      nextSearch.status = status;
    }

    if (board !== "all") {
      nextSearch.board = board;
    }

    if (sort !== "newest") {
      nextSearch.sort = sort;
    }

    navigate({
      to: "/",
      search: nextSearch,
      replace: true,
    });
  };

  return {
    selectedBoard,
    selectedStatus,
    sortBy,
    updateFilters,
  };
}
