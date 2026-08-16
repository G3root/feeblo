import type { HomePageSortOption } from "../../../hooks/use-home-page-filters";

export const SORT_ITEMS: Array<{
  label: string;
  value: HomePageSortOption;
}> = [
  { label: "Most upvoted", value: "upvotes" },
  { label: "Newest", value: "newest" },
  { label: "Oldest", value: "oldest" },
];
