/** The next id to hand out; the counter lives in this closure and nowhere else. */
const nextFilterId = (() => {
  let next = 0;

  return (): number => ++next;
})();

/**
 * A unique id for a filter row that has not been through the URL yet.
 *
 * A counter rather than a random string: filter ids are only compared within a
 * session, a counter never collides, and it keeps the module free of
 * randomness that a hydration test would have to pin.
 */
export function createFilterId(prefix = "filter"): string {
  return `${prefix}-${nextFilterId()}`;
}
