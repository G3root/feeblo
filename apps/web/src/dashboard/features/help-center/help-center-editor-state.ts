/**
 * What the banner says, kept beside the predicate so the copy and the state
 * cannot disagree about why the editor stopped writing.
 */
export const HELP_CENTER_ARTICLE_STALE_MESSAGE =
  "This article changed in another tab. Reload to continue.";

/**
 * Whether the row underneath an editor is still the row the editor loaded.
 *
 * The comparison is derived during render rather than held as state: the
 * `article` prop is a stale-while-revalidate read, and a background refresh
 * replaces it without remounting the editor (the route keys the component by
 * article id, not by timestamp). Deriving `stale` from the loaded timestamp and
 * the current one is the whole rule.
 *
 * A small XState machine would need an effect to forward each new `updatedAt`
 * into a `ROW_CHANGED` event — exactly the "derive state in an effect" shape
 * this codebase avoids — while a TanStack Form is already the editor's only
 * stateful machine. Two setters and a timestamp would add a lifecycle without
 * removing one.
 *
 * `openedAt` is undefined only while creating an article, which has no loaded
 * row to go stale; `currentAt` is undefined in the same mode and when a caller
 * renders the editor with no article.
 */
export function isHelpCenterArticleStale(
  openedAt: Date | undefined,
  currentAt: Date | undefined
): boolean {
  if (openedAt === undefined || currentAt === undefined) {
    return false;
  }

  return currentAt.getTime() !== openedAt.getTime();
}
