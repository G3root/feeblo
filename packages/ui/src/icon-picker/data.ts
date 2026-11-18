import {
  TABLER_FILLED_CATEGORIES,
  TABLER_FILLED_ICONS,
} from "./generated/tabler-filled-icons";
import type {
  IconPickerData,
  IconPickerDataCategory,
  IconPickerDataRow,
  IconPickerIcon,
  TablerFilledIconRecord,
} from "./types";

const ICON_PICKER_CATEGORIES = TABLER_FILLED_CATEGORIES;

type SearchableIcon = {
  icon: TablerFilledIconRecord;
  label: string;
  tags: string[];
};

/**
 * Normalising 1,054 labels and ~10,000 tags per keystroke is the one part of
 * the search that does not have to be lazy: the catalogue is fixed, so the
 * lowercase, hyphen-free form is built once and reused for every query.
 */
const searchableIcons: SearchableIcon[] = TABLER_FILLED_ICONS.map((icon) => ({
  icon,
  label: normalize(icon.label),
  tags: icon.tags.map((tag) => normalize(tag)),
}));

/**
 * Filters and ranks the catalogue. A label hit is worth ten tag hits, so
 * searching "arrow" puts `Arrow Up` above an icon that merely mentions arrows
 * in its tags — Frimousse's scoring, kept because it behaves well on a list
 * this size.
 */
function searchIcons(search: string): TablerFilledIconRecord[] {
  const searchText = normalize(search);

  if (!searchText) {
    return [...TABLER_FILLED_ICONS];
  }

  const matches = searchableIcons
    .flatMap((searchable) => {
      const score = scoreIcon(searchable, searchText);

      return score > 0 ? [{ icon: searchable.icon, score }] : [];
    })
    .sort((a, b) => b.score - a.score);

  return matches.map((match) => match.icon);
}

/**
 * A label hit is worth ten tag hits: searching "arrow" should put `Arrow Up`
 * above an icon that merely mentions arrows in its tags.
 */
function scoreIcon(searchable: SearchableIcon, searchText: string): number {
  let score = searchable.label.includes(searchText) ? 10 : 0;

  for (const tag of searchable.tags) {
    if (tag.includes(searchText)) {
      score += 1;
    }
  }

  return score;
}

export function getIconPickerData(
  columns: number,
  search: string
): IconPickerData {
  const columnCount = Math.max(1, Math.floor(columns));
  const matches = searchIcons(search);
  const iconsByCategory = Map.groupBy(matches, (icon) => icon.category);

  const rows: IconPickerDataRow[] = [];
  const categories: IconPickerDataCategory[] = [];
  const categoriesStartRowIndices: number[] = [];
  let startRowIndex = 0;

  for (const [categoryIndex, label] of ICON_PICKER_CATEGORIES.entries()) {
    const categoryIcons = iconsByCategory.get(categoryIndex);

    if (!categoryIcons || categoryIcons.length === 0) {
      continue;
    }

    const categoryRows = chunk(categoryIcons, columnCount).map((icons) => ({
      categoryIndex: categories.length,
      icons: icons.map((icon): IconPickerIcon => ({
        label: icon.label,
        name: icon.name,
      })),
    }));

    rows.push(...categoryRows);
    categories.push({
      label,
      rowsCount: categoryRows.length,
      startRowIndex,
    });
    categoriesStartRowIndices.push(startRowIndex);
    startRowIndex += categoryRows.length;
  }

  return {
    count: matches.length,
    categories,
    categoriesStartRowIndices,
    rows,
  };
}

function normalize(value: string): string {
  return value.toLowerCase().replaceAll("-", " ").replace(/\s+/g, " ").trim();
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, index * size + size)
  );
}
