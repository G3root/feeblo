import type { HomePageSortOption } from "../../../hooks/use-home-page-filters";
import { m } from "../../../paraglide/messages.js";

export function getSortItems(): Array<{
  label: string;
  value: HomePageSortOption;
}> {
  return [
    { label: m.just_frail_thrush(), value: "upvotes" },
    { label: m.direct_heavy_cat(), value: "newest" },
    { label: m.bright_quaint_cougar(), value: "oldest" },
  ];
}
