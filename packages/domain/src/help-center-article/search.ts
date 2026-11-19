/**
 * The help center's full-text search, as pure functions.
 *
 * The query reaches Postgres as a `tsquery`, and `to_tsquery` throws on
 * malformed input. Everything that turns a reader's text into that form lives
 * here so the only strings the repository ever binds are ones this module
 * produced: letters, digits and the `:*` prefix marker, and nothing else. A
 * raw `&`, `|`, `!`, `(`, `)`, `:` or `'` in a reader's question cannot reach
 * the parser because the tokenizer drops it first.
 *
 * The stemmer and the stopword list are `to_tsvector`'s, not ours: the column
 * is generated with the `english` configuration, so the query has to be built
 * with the same one or the two would tokenize differently. That is also why
 * there is no stopword list here — a query of only stopwords becomes an empty
 * `tsquery`, which matches nothing, which is the honest answer to "the do of".
 */

/**
 * How many distinct words one search may match on.
 *
 * A bound rather than a quality heuristic: every extra term is another branch
 * the GIN index walks, and a pasted paragraph is a denial-of-service shape
 * rather than a search. Twelve covers a question with room to spare.
 */
export const HELP_CENTER_SEARCH_MAX_TERMS = 12;

/**
 * The longest query the search box accepts, and the longest string stored in
 * `help_center_search_daily`.
 *
 * One constant for both because they are the same decision: the analytics
 * reports the searches the box allowed, and a stored query longer than the box
 * accepts could only come from a different client.
 */
export const HELP_CENTER_SEARCH_MAX_QUERY_LENGTH = 120;

/** A run of letters or digits; everything else separates words. */
const wordPattern = /[\p{L}\p{N}]+/gu;

/**
 * The form a query is compared and counted in: lowercased, single-spaced,
 * trimmed and bounded.
 *
 * Case and spacing are not meaning, so `  Export   CSV ` and `export csv` are
 * one bucket in the daily counters. Accents are left alone — folding them is a
 * language decision, and the `english` text-search configuration does not fold
 * them either, so doing it here would make the analytics disagree with the
 * results.
 */
export const normalizeHelpCenterSearchQuery = (input: string): string =>
  input
    .toLowerCase()
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, HELP_CENTER_SEARCH_MAX_QUERY_LENGTH);

/**
 * The distinct topic words of a query, in the order the reader wrote them.
 *
 * Single characters are dropped: `to_tsquery` accepts them, but a one-letter
 * term matches most of a corpus and ranks on noise. Duplicates are dropped
 * because `to_tsquery` ORs its branches, so a repeated word adds work without
 * adding recall.
 */
export const helpCenterSearchTerms = (input: string): readonly string[] => {
  const words = input.toLowerCase().match(wordPattern) ?? [];
  const terms: string[] = [];

  for (const word of words) {
    if (word.length < 2 || terms.includes(word)) {
      continue;
    }

    terms.push(word);

    if (terms.length === HELP_CENTER_SEARCH_MAX_TERMS) {
      break;
    }
  }

  return terms;
};

/**
 * The `to_tsquery` text for a set of terms, or `null` when there are none.
 *
 * Every branch is a prefix match (`:*`) AND-ed into nothing and OR-ed together,
 * so partial words find articles: a reader who has typed "export" should see
 * "Exporting your board" before the rest of the word arrives. Precision comes
 * from the ranking, not from demanding the whole word — `ts_rank_cd` already
 * puts a title match above a body match, and a whole-word requirement would
 * turn a slightly different inflection into no results at all.
 *
 * `null` rather than an empty string: an empty `tsquery` is a valid value that
 * matches nothing, and the caller should skip the database round trip instead
 * of running a query guaranteed to return no rows.
 */
export const helpCenterSearchTsQuery = (
  terms: readonly string[]
): string | null =>
  terms.length === 0 ? null : terms.map((term) => `${term}:*`).join(" | ");
