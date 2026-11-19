import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

/**
 * The article's search embedding: how it is built, stored and refreshed.
 *
 * The column triple (`embedding`, `embedding_model`, `embedded_at`) shipped with
 * the help center and nothing wrote it; this module is the writer. It is a
 * **best-effort index** rather than part of the article: a failure to embed
 * logs and leaves the columns null, because an article that cannot be saved
 * because a model is unreachable would be a worse product than an article that
 * does not participate in the semantic half of search.
 */

/** What the embedder answers with: the model that produced it, and the vector. */
export interface HelpCenterEmbedding {
  readonly model: string;
  readonly vector: readonly number[];
}

/**
 * The one capability this module needs.
 *
 * A port rather than `PostEmbeddingService` itself, so the article writer does
 * not depend on the post module. The deployment supplies its post-named
 * embedder, which is structurally this shape and is the right service to
 * borrow: one model, one dimension, one API key, and one vector space shared by
 * `post.embedding` and `help_center_article.embedding`. A second embedder with
 * its own configuration would be a second source of truth about which vectors
 * may be compared.
 *
 * Deliberately **infallible**. The concrete embedder fails with provider errors
 * that no caller here can act on, and every caller in this module treats a
 * failure exactly like "no embedding": log and carry on. Absorbing that at the
 * boundary — the adapter that binds the deployment's service in `handlers.ts`
 * — keeps one error channel instead of threading a provider's union through
 * the write path and the search program, neither of which can do anything with
 * it.
 */
export interface HelpCenterEmbedder {
  readonly embed: (
    input: string
  ) => Effect.Effect<Option.Option<HelpCenterEmbedding>, never>;
}

/**
 * One job, two failure channels.
 *
 * They stay separate because they are unrelated — a model that is down and a
 * statement that lost the database — and the scheduler absorbs both. Both are
 * inferred at the call site, so no caller names either.
 */
export interface HelpCenterArticleEmbeddingJob<SaveError = never> {
  readonly articleId: string;
  readonly content: string;
  readonly embedder: HelpCenterEmbedder;
  readonly organizationId: string;
  readonly repository: {
    readonly saveEmbedding: (args: {
      readonly articleId: string;
      readonly content: string;
      readonly model: string;
      readonly now: Date;
      readonly organizationId: string;
      readonly title: string;
      readonly vector: readonly number[];
    }) => Effect.Effect<boolean, SaveError>;
  };
  readonly title: string;
}

/**
 * How much of an article the embedding sees.
 *
 * An article's body is bounded at 200,000 characters and an embedding model's
 * context is not, so the head of the document is what identifies it: a question
 * is answered by a page's opening, not by its twentieth paragraph. Truncating
 * here rather than at the provider keeps the cost of an article bounded and the
 * failure mode obvious — the vector describes the part of the page a reader
 * sees first.
 */
export const HELP_CENTER_EMBEDDING_MAX_CHARS = 6000;

/**
 * The text that is embedded: the title, then the head of the body.
 *
 * The excerpt is deliberately absent. It is derived from the body, so including
 * it would weight the same sentences twice, and the title already carries the
 * weight the lexical index gives it.
 */
export const helpCenterArticleEmbeddingInput = ({
  content,
  title,
}: {
  readonly content: string;
  readonly title: string;
}): string =>
  `${title.trim()}\n\n${content.trim().slice(0, HELP_CENTER_EMBEDDING_MAX_CHARS)}`;

/**
 * Generates and stores one article's embedding.
 *
 * Not forked: the caller owns the lifetime. `scheduleHelpCenterArticleEmbedding`
 * is the detached entry point every write path uses.
 */
export const generateHelpCenterArticleEmbedding = Effect.fn(
  "HelpCenterArticleEmbedding.generate"
)(function* <SaveError>(payload: HelpCenterArticleEmbeddingJob<SaveError>) {
  const embedding = yield* payload.embedder.embed(
    helpCenterArticleEmbeddingInput(payload)
  );

  if (Option.isNone(embedding)) {
    // No API key, or a model that answered nothing: not an error, just an
    // article that will not rank semantically.
    return;
  }

  const now = yield* DateTime.nowAsDate;

  yield* payload.repository.saveEmbedding({
    articleId: payload.articleId,
    content: payload.content,
    model: embedding.value.model,
    now,
    organizationId: payload.organizationId,
    title: payload.title,
    vector: embedding.value.vector,
  });
});

/**
 * Runs an embedding job detached, and never lets it fail the write.
 *
 * Detached because the write is already durable: the reader who saved an
 * article should not wait on a model call, and a provider outage should not
 * turn an edit into a failed request. A failed job leaves the columns null,
 * which is the state the semantic pass already handles by skipping the row.
 */
export const scheduleHelpCenterArticleEmbedding = <SaveError>(
  payload: HelpCenterArticleEmbeddingJob<SaveError>
) =>
  generateHelpCenterArticleEmbedding(payload).pipe(
    Effect.catchCause((cause) =>
      Effect.logWarning(
        "Failed to generate help center article embedding",
        cause
      ).pipe(
        Effect.annotateLogs({
          articleId: payload.articleId,
          organizationId: payload.organizationId,
        })
      )
    ),
    Effect.forkDetach({ startImmediately: true }),
    Effect.asVoid
  );
