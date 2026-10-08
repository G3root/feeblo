import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import {
  type PostEmbeddingService,
  postEmbeddingInput,
} from "./embedding-service";
import type { TPostSuggestionCandidates } from "./repository";
import type { TPostSuggestions } from "./schema";

export const MIN_SUGGESTION_SIMILARITY = 0.3;

export const SUGGESTION_MAX_DISTANCE = 1 - MIN_SUGGESTION_SIMILARITY;

const words = (value: string): ReadonlySet<string> =>
  new Set(value.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);

export const lexicalSimilarity = (left: string, right: string): number => {
  const leftWords = words(left);
  const rightWords = words(right);
  const intersection = [...leftWords].filter((word) =>
    rightWords.has(word)
  ).length;
  const union = new Set([...leftWords, ...rightWords]).size;
  return union === 0 ? 0 : intersection / union;
};

export const postLexicalSimilarity = (
  input: string,
  post: { readonly content: string; readonly title: string }
): number => lexicalSimilarity(input, postEmbeddingInput(post));

/**
 * The suggestion search's collaborators.
 *
 * Deliberately the two capabilities the program reads, not the services that
 * own them: the dashboard and the widget both hold a `PostRepository` and a
 * `PostEmbeddingService`, but a test needs only a candidate query and an
 * embedder — no database and no OpenAI client. Embeddings are optional
 * because the dashboard reads them with `Effect.serviceOption` when the
 * deployment has no embedding key; absent, the search is lexical only.
 *
 * `Row` is the repository's own projection, so the program returns exactly the
 * rows the surface gave it; only the query's `distance` column is dropped,
 * because it orders the candidates and is not part of a post a surface
 * publishes.
 */
export interface PostSuggestionsDependencies<Row, E, R> {
  readonly candidates: (
    args: TPostSuggestionCandidates
  ) => Effect.Effect<readonly Row[], E, R>;
  readonly embeddings: Option.Option<PostEmbeddingService["Service"]>;
}

/** The columns the ranking reads from a candidate row. */
export interface PostSuggestionCandidate {
  readonly content: string;
  readonly distance: number | null;
  readonly title: string;
}

/** One search: the surface-neutral request shape both projections share. */
export type PostSuggestionsSearch = TPostSuggestions & {
  readonly publicOnly: boolean;
};

/** The result count when a caller names none, the dashboard's dialog default. */
export const SUGGESTION_DEFAULT_LIMIT = 5;

/**
 * How many rows the lexical fallback ranks before slicing to the result limit.
 *
 * A constant floor rather than a multiple of the page: a lexical match can sit
 * anywhere in the workspace's recent history, so a small request must still
 * score a useful pool. The semantic pass needs no such floor — the vector
 * index already orders the whole board.
 */
export const SUGGESTION_LEXICAL_POOL_MINIMUM = 25;

/**
 * Ranks a workspace's posts against a draft title and body.
 *
 * One program, three surfaces: `PostSuggestions` (dashboard),
 * `PostSuggestionsPublic` (portal), and the widget's `suggestPosts`. The
 * semantic pass — query embedding, candidate query ordered by cosine distance,
 * distance threshold — answers when any stored vector is close enough; the
 * lexical pass otherwise ranks the pool by token overlap. Both surfaces must
 * answer the same call the same way, so the limits and the fallback live here
 * rather than once per surface: the semantic pass requests `limit` rows, the
 * lexical pool is `max(25, limit × 5)`, and the result is sliced to `limit`.
 *
 * The returned rows are the repository's own post projection, so a surface can
 * project what it publishes — the dashboard returns the rows (redacting
 * creator identity where the RPC requires it) and the widget maps the four
 * fields its endpoint publishes.
 *
 * An embedding failure is logged and the search falls back to lexical ranking:
 * embeddings are an optional enhancement, and failing a suggestion request
 * because the model is unreachable answers no useful question.
 */
export const makePostSuggestions = <Row extends PostSuggestionCandidate, E, R>(
  dependencies: PostSuggestionsDependencies<Row, E, R>
) =>
  Effect.fn("PostSuggestions.suggest")(function* (args: PostSuggestionsSearch) {
    const { boardId, content, limit, organizationId, publicOnly, title } = args;
    const input = postEmbeddingInput({ content, title });
    const resultLimit = limit ?? SUGGESTION_DEFAULT_LIMIT;
    const lexicalPool = Math.max(
      SUGGESTION_LEXICAL_POOL_MINIMUM,
      resultLimit * 5
    );

    const queryEmbedding = Option.isSome(dependencies.embeddings)
      ? yield* dependencies.embeddings.value
          .embed(input)
          .pipe(
            Effect.catch((cause) =>
              Effect.logWarning(
                "Failed to generate suggestion query embedding",
                cause
              ).pipe(Effect.as(Option.none()))
            )
          )
      : Option.none();

    const candidates = yield* dependencies.candidates({
      organizationId,
      ...(boardId !== undefined && { boardId }),
      ...(Option.isSome(queryEmbedding) && {
        embedding: queryEmbedding.value.vector,
        embeddingModel: queryEmbedding.value.model,
      }),
      limit: Option.isSome(queryEmbedding) ? resultLimit : lexicalPool,
      publicOnly,
    });

    if (Option.isSome(queryEmbedding)) {
      const matches = candidates
        .filter(
          (candidate) =>
            candidate.distance !== null &&
            candidate.distance <= SUGGESTION_MAX_DISTANCE
        )
        .map(({ distance: _distance, ...post }) => post);
      if (matches.length > 0) {
        return matches;
      }
    }

    const lexicalCandidates = Option.isSome(queryEmbedding)
      ? yield* dependencies.candidates({
          organizationId,
          ...(boardId !== undefined && { boardId }),
          limit: lexicalPool,
          publicOnly,
        })
      : candidates;

    return lexicalCandidates
      .map((row) => {
        const { distance: _distance, ...post } = row;
        return { post, score: postLexicalSimilarity(input, row) };
      })
      .filter(({ score }) => score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, resultLimit)
      .map(({ post }) => post);
  });
