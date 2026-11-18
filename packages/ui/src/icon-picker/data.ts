import type {
  IconPickerData,
  IconPickerDataCategory,
  IconPickerDataRow,
  IconPickerIcon,
  TablerFilledIconRecord,
} from "./types";

type SearchableIcon = {
  icon: TablerFilledIconRecord;
  label: string;
  tags: string[];
};

export type IconPickerCatalogue = {
  categories: readonly string[];
  searchableIcons: readonly SearchableIcon[];
};

/**
 * The empty result set a picker renders before its catalogue arrives. It is
 * frozen because every store starts on this same object and the store only
 * replaces `data`, never mutates it.
 */
export const EMPTY_ICON_PICKER_DATA: IconPickerData = {
  categories: [],
  categoriesStartRowIndices: [],
  count: 0,
  rows: [],
};

// Hoisted so a keystroke does not allocate a RegExp per normalised label or
// tag. `replace` resets a global regex's lastIndex, so reuse is safe.
const WHITESPACE_PATTERN = /\s+/g;

type CatalogueState = {
  promise: Promise<IconPickerCatalogue> | null;
};

const catalogueState: CatalogueState = { promise: null };

/**
 * Loads the generated catalogue in its own chunk.
 *
 * The sprite is what an icon needs to draw, so it is fetched by the first
 * `TablerIcon` — a trigger can show the selected icon without opening the
 * picker. The catalogue is only needed once the picker itself mounts, which is
 * why this is a dynamic import with a literal path: the bundler splits it, and
 * a page that never opens a picker never downloads it.
 */
export function loadIconPickerCatalogue(): Promise<IconPickerCatalogue> {
  if (!catalogueState.promise) {
    catalogueState.promise = import("./generated/tabler-filled-icons")
      .then(({ TABLER_FILLED_CATEGORIES, TABLER_FILLED_ICONS }) => ({
        categories: TABLER_FILLED_CATEGORIES,
        searchableIcons: TABLER_FILLED_ICONS.map((icon) => ({
          icon,
          label: normalize(icon.label),
          tags: icon.tags.map((tag) => normalize(tag)),
        })),
      }))
      .catch((error: Error) => {
        // The next picker that opens should be able to retry, rather than
        // sharing a failure that may have been transient.
        catalogueState.promise = null;
        throw error;
      });
  }

  return catalogueState.promise;
}

/**
 * Starts the catalogue chunk early, for a trigger's `onPointerEnter`
 * or `onFocus`. Errors are swallowed here — the picker reports them when it
 * mounts, and a preload must not surface an unhandled rejection.
 */
export function preloadIconPickerCatalogue(): void {
  void loadIconPickerCatalogue().catch(noop);
}

/**
 * Filters and ranks the catalogue. A label hit is worth ten tag hits, so
 * searching "arrow" puts `Arrow Up` above an icon that merely mentions arrows
 * in its tags — Frimousse's scoring, kept because it behaves well on a list
 * this size.
 */
function searchIcons(
  catalogue: IconPickerCatalogue,
  search: string
): TablerFilledIconRecord[] {
  const searchText = normalize(search);

  if (!searchText) {
    return catalogue.searchableIcons.map((searchable) => searchable.icon);
  }

  return catalogue.searchableIcons
    .flatMap((searchable) => {
      const score = scoreIcon(searchable, searchText);

      return score > 0 ? [{ icon: searchable.icon, score }] : [];
    })
    .toSorted((a, b) => b.score - a.score)
    .map((match) => match.icon);
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
  catalogue: IconPickerCatalogue,
  columns: number,
  search: string
): IconPickerData {
  const columnCount = Math.max(1, Math.floor(columns));
  const matches = searchIcons(catalogue, search);
  const iconsByCategory = Map.groupBy(matches, (icon) => icon.category);

  const rows: IconPickerDataRow[] = [];
  const categories: IconPickerDataCategory[] = [];
  const categoriesStartRowIndices: number[] = [];
  let startRowIndex = 0;

  for (const [categoryIndex, label] of catalogue.categories.entries()) {
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
  return value
    .toLowerCase()
    .replaceAll("-", " ")
    .replace(WHITESPACE_PATTERN, " ")
    .trim();
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, index * size + size)
  );
}

function noop(): void {
  // A preload that fails is reported by the picker when it mounts.
}
