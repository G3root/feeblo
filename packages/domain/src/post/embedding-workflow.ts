import { Database, schema } from "@feeblo/db";
import { and, eq } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as S from "effect/Schema";
import * as W from "effect/unstable/workflow";
import {
  PostEmbeddingService,
  postEmbeddingInput,
} from "./embedding-service";

export const PostEmbeddingWorkflow = W.Workflow.make({
  name: "PostEmbeddingWorkflow",
  payload: {
    content: S.String,
    postId: S.String,
    organizationId: S.String,
    revision: S.String,
    title: S.String,
  },
  error: S.Never,
  idempotencyKey: ({ postId, revision }) => `${postId}:${revision}`,
});

export const schedulePostEmbedding = (payload: {
  readonly content: string;
  readonly postId: string;
  readonly organizationId: string;
  readonly revision: string;
  readonly title: string;
}) => PostEmbeddingWorkflow.execute(payload, { discard: true });

export const PostEmbeddingWorkflowLayer = PostEmbeddingWorkflow.toLayer(
  Effect.fnUntraced(function* (payload, executionId) {
    yield* Effect.annotateLogsScoped({
      executionId,
      postId: payload.postId,
      organizationId: payload.organizationId,
      revision: payload.revision,
    });

    yield* W.Activity.make({
      name: "GeneratePostEmbedding",
      error: S.Never,
      execute: Effect.gen(function* () {
        const db = yield* Database.Database;
        const embeddings = yield* PostEmbeddingService;
        const embedding = yield* embeddings.embed(postEmbeddingInput(payload));

        if (embedding._tag === "None") {
          return;
        }

        yield* db
          .update(schema.postTable)
          .set({
            embeddedAt: new Date(),
            embedding: [...embedding.value.vector],
            embeddingModel: embedding.value.model,
          })
          .where(
            and(
              eq(schema.postTable.id, payload.postId),
              eq(
                schema.postTable.organizationId,
                payload.organizationId
              ),
              eq(schema.postTable.title, payload.title),
              eq(schema.postTable.content, payload.content)
            )
          );
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("Failed to generate post embedding", cause)
        )
      ),
    });
  })
);
