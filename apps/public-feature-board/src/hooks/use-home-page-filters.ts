import { useNavigate, useSearch } from "@tanstack/react-router";
import { useCallback } from "react";

import { boardPaths } from "../lib/board-links";

export type HomePageSortOption = "upvotes" | "newest" | "oldest";
type FilterValue = "all" | string;

const SORT_OPTIONS: Set<HomePageSortOption> = new Set([
  "upvotes",
  "newest",
  "oldest",
]);

/**
 * The board's home route owns the search-param schema; this hook only reads it,
 * so it stays untyped here rather than depending on the host's route ids.
 */
function useHomeSearch(): { board?: string; sort?: string; status?: string } {
  return useSearch({ strict: false });
}

function normalizeFilterValue(value: string | undefined): FilterValue {
  return value?.trim() || "all";
}

function normalizeSortValue(value: string | undefined): HomePageSortOption {
  // SAFETY: The runtime invariant checked by the surrounding code guarantees this type.
  return SORT_OPTIONS.has(value as HomePageSortOption)
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
  const search = useHomeSearch();
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

  // Stable identity: `HomeProvider` memoizes its context value on this, so a
  // new closure per render would re-render every consumer on each keystroke.
  const updateFilters = useCallback(
    ({
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
        // Board navigation uses the host router's internal `/s` spelling
        // everywhere (`lib/board-links.ts`); the host rewrite hides it from
        // visitors, and it stays correct on a host that also serves the board
        // under `/s/...`.
        to: boardPaths.home,
        search: nextSearch,
        replace: true,
      });
    },
    [navigate, selectedBoard, selectedStatus, sortBy]
  );

  return {
    selectedBoard,
    selectedStatus,
    sortBy,
    updateFilters,
  };
}
