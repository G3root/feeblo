import { OpenAiClient, OpenAiEmbeddingModel } from "@effect/ai-openai";
import { DEFAULT_POST_EMBEDDING_DIMENSIONS } from "@feeblo/db";
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import { EmbeddingModel } from "effect/unstable/ai";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";

export interface PostEmbedding {
  readonly model: string;
  readonly vector: readonly number[];
}

export const DEFAULT_POST_EMBEDDING_MODEL = "text-embedding-3-small";
export { DEFAULT_POST_EMBEDDING_DIMENSIONS };

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
}> {}

const make = Effect.gen(function* () {
  const apiKey = yield* Config.redacted("EMBEDDING_API_KEY").pipe(
    Config.option
  );
  const model = yield* Config.string("EMBEDDING_MODEL").pipe(
    Config.withDefault(DEFAULT_POST_EMBEDDING_MODEL)
  );
  const dimensions = yield* Config.number("EMBEDDING_DIMENSIONS").pipe(
    Config.withDefault(DEFAULT_POST_EMBEDDING_DIMENSIONS)
  );
  if (
    !Number.isSafeInteger(dimensions) ||
    dimensions < 1 ||
    dimensions > 2000
  ) {
    return yield* new InvalidPostEmbeddingConfigurationError({ dimensions });
  }
  const apiUrl = yield* Config.string("EMBEDDING_API_URL").pipe(Config.option);
  const timeout = yield* Config.duration("EMBEDDING_TIMEOUT").pipe(
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
      ...(Option.isSome(apiUrl) ? { apiUrl: apiUrl.value } : {}),
    }).pipe(Layer.provide(FetchHttpClient.layer));
    const modelLayer = OpenAiEmbeddingModel.layer({
      model,
      config: { dimensions },
    }).pipe(Layer.provide(clientLayer));

    const embeddingModel = yield* EmbeddingModel.EmbeddingModel.pipe(
      Effect.provide(modelLayer)
    );
    const response = yield* embeddingModel.embed(input).pipe(
      Effect.timeout(timeout)
    );
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
