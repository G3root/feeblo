/**
 * Names when every id still resolves, otherwise "3 labels".
 *
 * The expected count is passed separately because the caller has already
 * dropped the ids that no longer resolve, and the summary must describe the
 * stored filter rather than only its readable part.
 */
export function namesOrCount(
  names: readonly string[],
  singular: string,
  plural: string,
  expectedCount = names.length
) {
  if (names.length === expectedCount) {
    return names.join(", ");
  }

  return `${expectedCount} ${expectedCount === 1 ? singular : plural}`;
}
