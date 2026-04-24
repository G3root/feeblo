import { useSearchParams } from "wouter";

export type HomePageSortOption = "upvotes" | "newest" | "oldest";
type FilterValue = "all" | string;

const BOARD_SEARCH_PARAM = "board";
const SORT_SEARCH_PARAM = "sort";
const STATUS_SEARCH_PARAM = "status";
const SORT_OPTIONS: readonly HomePageSortOption[] = [
  "upvotes",
  "newest",
  "oldest",
];

function normalizeFilterValue(value: string | null): FilterValue {
  return value?.trim() || "all";
}

function normalizeSortValue(value: string | null): HomePageSortOption {
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
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedStatusFromUrl = normalizeFilterValue(
    searchParams.get(STATUS_SEARCH_PARAM)
  );
  const selectedBoardFromUrl = normalizeFilterValue(
    searchParams.get(BOARD_SEARCH_PARAM)
  );
  const sortBy = normalizeSortValue(searchParams.get(SORT_SEARCH_PARAM));

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
    setSearchParams((currentParams) => {
      const nextParams = new URLSearchParams(currentParams);

      if (status === "all") {
        nextParams.delete(STATUS_SEARCH_PARAM);
      } else {
        nextParams.set(STATUS_SEARCH_PARAM, status);
      }

      if (board === "all") {
        nextParams.delete(BOARD_SEARCH_PARAM);
      } else {
        nextParams.set(BOARD_SEARCH_PARAM, board);
      }

      if (sort === "newest") {
        nextParams.delete(SORT_SEARCH_PARAM);
      } else {
        nextParams.set(SORT_SEARCH_PARAM, sort);
      }

      return nextParams;
    });
  };

  return {
    selectedBoard,
    selectedStatus,
    sortBy,
    updateFilters,
  };
}
