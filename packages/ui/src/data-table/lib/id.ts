let nextFilterId = 0;

/**
 * A unique id for a filter row that has not been through the URL yet.
 *
 * A counter rather than a random string: filter ids are only compared within a
 * session, a counter never collides, and it keeps the module free of
 * randomness that a hydration test would have to pin.
 */
export function createFilterId(prefix = "filter"): string {
  nextFilterId += 1;
  return `${prefix}-${nextFilterId}`;
}
