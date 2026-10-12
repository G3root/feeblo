import { OpenAiClient, OpenAiEmbeddingModel } from "@effect/ai-openai";
import {
  Database,
  DEFAULT_POST_EMBEDDING_DIMENSIONS as defaultPostEmbeddingDimensions,
  schema,
} from "@feeblo/db";
import { and, eq } from "drizzle-orm";
import { EmbeddingModel } from "effect/ai";
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";

export interface PostEmbedding {
  readonly model: string;
  readonly vector: readonly number[];
}

export const DEFAULT_POST_EMBEDDING_MODEL = "text-embedding-3-small";
export const DEFAULT_POST_EMBEDDING_DIMENSIONS = defaultPostEmbeddingDimensions;

export class InvalidPostEmbeddingDimensionsError extends Data.TaggedError(
  "InvalidPostEmbeddingDimensionsError"
)<{
  readonly actual: number;
  readonly expected: number;
}> {}

export class InvalidPostEmbeddingConfigurationError extends Data.TaggedError(
  "InvalidPostEmbeddingConfigurationError"
)<{
  readonly dimensions: number;
  readonly message: string;
}> {}

const make = Effect.gen(function* () {
  const apiKey = yield* Config.Redacted("EMBEDDING_API_KEY").pipe(
    Config.option
  );
  const model = yield* Config.String("EMBEDDING_MODEL").pipe(
    Config.withDefault(DEFAULT_POST_EMBEDDING_MODEL)
  );
  const dimensions = yield* Config.Number("EMBEDDING_DIMENSIONS").pipe(
    Config.withDefault(defaultPostEmbeddingDimensions)
  );
  if (
    !Number.isSafeInteger(dimensions) ||
    dimensions < 1 ||
    dimensions > 2000
  ) {
    return yield* new InvalidPostEmbeddingConfigurationError({
      dimensions,
      message: "EMBEDDING_DIMENSIONS must be an integer between 1 and 2000",
    });
  }
  if (dimensions !== defaultPostEmbeddingDimensions) {
    return yield* new InvalidPostEmbeddingConfigurationError({
      dimensions,
      message: `EMBEDDING_DIMENSIONS (${dimensions}) must match the post embedding column dimension (${defaultPostEmbeddingDimensions})`,
    });
  }
  const apiUrl = yield* Config.String("EMBEDDING_API_URL").pipe(Config.option);
  const normalizedApiUrl = Option.filter(
    apiUrl,
    (value) => value.trim().length > 0
  );
  const timeout = yield* Config.Duration("EMBEDDING_TIMEOUT").pipe(
    Config.withDefault(Duration.seconds(10))
  );

  const embed = Effect.fn("PostEmbeddingService.embed")(function* (
    input: string
  ) {
    if (
      Option.isNone(apiKey) ||
      Redacted.value(apiKey.value).trim().length === 0
    ) {
      return Option.none<PostEmbedding>();
    }

    const clientLayer = OpenAiClient.layer({
      apiKey: apiKey.value,
      ...(Option.isSome(normalizedApiUrl) && {
        apiUrl: normalizedApiUrl.value.trim(),
      }),
    }).pipe(Layer.provide(FetchHttpClient.layer));
    const modelLayer = OpenAiEmbeddingModel.layer({
      model,
      config: { dimensions },
    }).pipe(Layer.provide(clientLayer));

    const embeddingModel = yield* EmbeddingModel.EmbeddingModel.pipe(
      // The model layer is built from this service's own config read and used
      // exactly once, inside the layer build that creates the service. This
      // build is that layer's entry point.
      // eslint-disable-next-line effecttsgo/strict-effect-provide -- one-shot layer inside the service build
      Effect.provide(modelLayer)
    );
    const response = yield* embeddingModel
      .embed(input)
      .pipe(Effect.timeout(timeout));
    if (response.vector.length !== dimensions) {
      return yield* new InvalidPostEmbeddingDimensionsError({
        actual: response.vector.length,
        expected: dimensions,
      });
    }

    return Option.some<PostEmbedding>({
      model,
      vector: response.vector,
    });
  });

  return { embed };
});

export class PostEmbeddingService extends Context.Service<PostEmbeddingService>()(
  "PostEmbeddingService",
  { make }
) {
  static readonly layer = Layer.effect(this, this.make);
}

export const postEmbeddingInput = ({
  title,
  content,
}: {
  readonly title: string;
  readonly content: string;
}): string => `${title.trim()}\n\n${content.trim()}`;

export interface PostEmbeddingJob {
  readonly content: string;
  readonly embeddingService?: Effect.Success<typeof make>;
  readonly organizationId: string;
  readonly postId: string;
  readonly title: string;
}

/**
 * Generates and stores a post's search embedding once.
 *
 * Not forked: the caller owns the lifetime and the concurrency. An ordinary
 * create uses {@link schedulePostEmbeddingBestEffort}, which detaches the job;
 * a bulk import uses this one through a bounded pass, because 20,000 detached
 * jobs at once is a stampede rather than background work.
 */
export const generatePostEmbedding = Effect.fn("PostEmbedding.generate")(
  function* (payload: Omit<PostEmbeddingJob, "embeddingService">) {
    const db = yield* Database.Database;
    const embeddings = yield* PostEmbeddingService;
    const embedding = yield* embeddings.embed(postEmbeddingInput(payload));

    if (Option.isNone(embedding)) {
      return;
    }

    const now = yield* DateTime.nowAsDate;
    yield* db
      .update(schema.postTable)
      .set({
        embeddedAt: now,
        embedding: [...embedding.value.vector],
        embeddingModel: embedding.value.model,
      })
      .where(
        and(
          eq(schema.postTable.id, payload.postId),
          eq(schema.postTable.organizationId, payload.organizationId),
          eq(schema.postTable.title, payload.title),
          eq(schema.postTable.content, payload.content)
        )
      );
  }
);

export const schedulePostEmbeddingBestEffort = ({
  embeddingService,
  ...payload
}: PostEmbeddingJob) => {
  const job = embeddingService
    ? generatePostEmbedding(payload).pipe(
        Effect.provideService(PostEmbeddingService, embeddingService)
      )
    : generatePostEmbedding(payload).pipe(
        // The job is forked detached, so it outlives the caller's scope and
        // must provision its own service. The optional embeddingService above
        // is the seam tests and callers with a live service use instead.
        // eslint-disable-next-line effecttsgo/strict-effect-provide -- detached job self-provisions
        Effect.provide(PostEmbeddingService.layer)
      );

  return job.pipe(
    Effect.catchCause((cause) =>
      Effect.logWarning("Failed to generate post embedding", cause).pipe(
        Effect.annotateLogs({
          postId: payload.postId,
          organizationId: payload.organizationId,
        })
      )
    ),
    Effect.forkDetach({ startImmediately: true }),
    Effect.asVoid
  );
};
