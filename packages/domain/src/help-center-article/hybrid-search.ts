import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import type { HelpCenterEmbedder } from "./embedding";

/**
 * The two halves of a help center search, and the rule that decides whether the
 * second one runs.
 *
 * Lexical search is the product: it is exact, explainable, free per query, and
 * already ranked by the column's own weights. The embedding exists for the
 * queries words cannot answer — a reader who describes the problem in their own
 * vocabulary will never match a page written in the documentation's.
 *
 * So the semantic pass is a **rescue, not a ranker**. It runs only when the
 * lexical pass found fewer than {@link HELP_CENTER_SEMANTIC_FILL_BELOW} pages,
 * and its hits are appended after the lexical ones rather than merged into one
 * score. That is a deliberate refusal to fuse two numbers that do not share a
 * scale: `ts_rank_cd` is unbounded and depends on the query's term count, cosine
 * distance is bounded and model-specific, and any arithmetic combining them
 * would be a constant nobody could justify with evidence. Exact-word evidence
 * keeps its precedence, the near-miss evidence fills the rest, and a learned
 * ranker is a later decision with data behind it.
 *
 * The rescue rule also bounds the cost. A public, unauthenticated search box
 * must not spend a model call on the common case, and the common case is a
 * query that matches. Only a thin result set — the searches that were about to
 * fail — pays for an embedding.
 */

/** The hit shape both halves return, and the merge keys on. */
export interface HelpCenterSearchHitLike {
  readonly id: string;
}

/** A lexical search request. The repository's `search` matches this shape. */
export interface HelpCenterLexicalSearch {
  readonly includeUnreadable: boolean;
  readonly limit: number;
  readonly organizationId: string;
  readonly query: string;
  readonly strict?: boolean | undefined;
}

/** A semantic search request. The repository's `searchByVector` matches this. */
export interface HelpCenterSemanticSearch {
  readonly embedding: readonly number[];
  readonly embeddingModel: string;
  readonly includeUnreadable: boolean;
  readonly limit: number;
  readonly organizationId: string;
}

export type HelpCenterSearchRequest = Omit<HelpCenterLexicalSearch, "limit"> & {
  readonly limit?: number | undefined;
};

export interface HelpCenterSearchDependencies<Hit, E, R> {
  /**
   * The deployment's embedder, when it has one.
   *
   * Its own error is `unknown` because the program absorbs it: a model that
   * fails is a search that answers lexically, not a search that fails, so the
   * failure never reaches the caller's error channel.
   */
  readonly embeddings: Option.Option<HelpCenterEmbedder>;
  readonly lexical: (
    args: HelpCenterLexicalSearch
  ) => Effect.Effect<readonly Hit[], E, R>;
  readonly semantic: (
    args: HelpCenterSemanticSearch
  ) => Effect.Effect<
    readonly (Hit & { readonly distance: number | null })[],
    E,
    R
  >;
}

/** The result count when a caller names none. */
export const HELP_CENTER_SEARCH_DEFAULT_LIMIT = 10;

/**
 * How thin a lexical result must be before the semantic pass runs.
 *
 * Three is the number of hits a reader scans before deciding the page is
 * useless. Above it, appending near-misses adds noise to a page that already
 * answered; below it, the search looks broken.
 */
export const HELP_CENTER_SEMANTIC_FILL_BELOW = 3;

/**
 * The furthest a page may sit from the query and still be offered.
 *
 * Stricter than the post-suggestion threshold, because the two mistakes are not
 * equal: a wrong "this may already exist" post costs the reader a glance and
 * can be merged later, while a wrong documentation link sends them to a page
 * about something else and makes the help center look unreliable.
 */
export const HELP_CENTER_SEMANTIC_MAX_DISTANCE = 0.6;

/**
 * Ranks a workspace's documentation against a reader's text.
 *
 * One program, three surfaces: `SearchHelpCenterArticles` (dashboard),
 * `SearchHelpCenterArticlesPublic` (portal), and the widget's deflection. The
 * dashboard and portal differ only in `includeUnreadable`, which stays a
 * parameter for the reason it always was — a draft must not be reachable from a
 * search box.
 *
 * `strict` disables the semantic pass rather than narrowing it. A strict search
 * is the widget's deflection, whose whole purpose is to show a page that shares
 * the visitor's words; a semantic neighbour with no word overlap is exactly the
 * suggestion that looks like a mistake beside a feedback form.
 */
export const makeHelpCenterSearch = <Hit extends HelpCenterSearchHitLike, E, R>(
  dependencies: HelpCenterSearchDependencies<Hit, E, R>
) =>
  Effect.fn("HelpCenterSearch.search")(function* (
    request: HelpCenterSearchRequest
  ) {
    const limit = request.limit ?? HELP_CENTER_SEARCH_DEFAULT_LIMIT;

    const lexicalArgs: HelpCenterLexicalSearch = {
      includeUnreadable: request.includeUnreadable,
      limit,
      organizationId: request.organizationId,
      query: request.query,
      strict: request.strict,
    };

    const lexicalHits = yield* dependencies.lexical(lexicalArgs);

    const worthRescuing =
      request.strict !== true &&
      lexicalHits.length < HELP_CENTER_SEMANTIC_FILL_BELOW &&
      Option.isSome(dependencies.embeddings) &&
      request.query.trim().length > 0;

    if (!worthRescuing) {
      return lexicalHits;
    }

    // The port is infallible: a model that is down answers `none`, and the
    // adapter that binds the deployment's service is where that decision is
    // made and logged.
    const queryEmbedding = yield* dependencies.embeddings.value.embed(
      request.query.trim()
    );

    if (Option.isNone(queryEmbedding)) {
      return lexicalHits;
    }

    const semanticHits = yield* dependencies.semantic({
      embedding: queryEmbedding.value.vector,
      embeddingModel: queryEmbedding.value.model,
      includeUnreadable: request.includeUnreadable,
      limit,
      organizationId: request.organizationId,
    });

    const nearEnough = semanticHits
      .filter(
        (hit) =>
          hit.distance !== null &&
          hit.distance <= HELP_CENTER_SEMANTIC_MAX_DISTANCE
      )
      .map(({ distance: _distance, ...hit }) => hit);

    const seen = new Set(lexicalHits.map((hit) => hit.id));

    // `filter` rather than a loop with a `push`: the repository returns one row
    // per article, so the only duplicates the merge can see are the ones the
    // lexical pass already returned, and those are what `seen` holds.
    const fill = nearEnough
      .filter((hit) => !seen.has(hit.id))
      .slice(0, Math.max(0, limit - lexicalHits.length));

    return [...lexicalHits, ...fill];
  });
