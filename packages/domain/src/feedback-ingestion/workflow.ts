import { transaction } from "@feeblo/db";
import * as Effect from "effect/Effect";
import * as S from "effect/Schema";
import * as W from "effect/unstable/workflow";
import {
  FeedbackProcessingDataError,
  FeedbackProcessingErrors,
} from "./errors";
import { FeedbackAssessor } from "./interpreter";
import { FeedbackIngestionRepository } from "./repository";

export const FeedbackIngestionWorkflow = W.Workflow.make({
  name: "FeedbackIngestionWorkflow",
  payload: {
    organizationId: S.String,
    receiptId: S.String,
  },
  error: FeedbackProcessingErrors,
  idempotencyKey: ({ receiptId }) => receiptId,
});

const mapProcessingError =
  (operation: string) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(
      Effect.mapError(
        (cause) => new FeedbackProcessingDataError({ operation, cause })
      )
    );

const describeProcessingError = (
  error: S.Schema.Type<typeof FeedbackProcessingErrors>
) => {
  switch (error._tag) {
    case "FeedbackProcessingDataError":
      return `${error.operation}: ${String(error.cause)}`;
    case "FeedbackNotFoundError":
      return error.message ?? "Feedback was not found";
    default:
      return "Feedback processing failed";
  }
};

export const FeedbackIngestionWorkflowLayer = FeedbackIngestionWorkflow.toLayer(
  Effect.fnUntraced(function* (payload, executionId) {
    yield* Effect.annotateLogsScoped({
      executionId,
      organizationId: payload.organizationId,
      receiptId: payload.receiptId,
    });

    const processFeedback = Effect.gen(function* () {
      yield* W.Activity.make({
        name: "MatchFeedbackContact",
        success: S.NullOr(S.String),
        error: FeedbackProcessingErrors,
        execute: transaction(
          FeedbackIngestionRepository.pipe(
            Effect.flatMap((repository) => repository.resolveIdentity(payload))
          )
        ).pipe(mapProcessingError("match feedback contact")),
      }).pipe(W.Activity.retry({ times: 3 }));

      const receipt = yield* W.Activity.make({
        name: "LoadFeedbackReceipt",
        success: S.Struct({
          sender: S.Struct({
            upstreamId: S.optional(S.String),
            email: S.optional(S.String),
            name: S.optional(S.String),
          }),
          message: S.Struct({
            text: S.String,
            title: S.optional(S.String),
          }),
          metadata: S.Record(S.String, S.Unknown),
        }),
        error: FeedbackProcessingErrors,
        execute: FeedbackIngestionRepository.pipe(
          Effect.flatMap((repository) => repository.getForProcessing(payload)),
          Effect.map(({ sender, message, metadata }) => ({
            sender,
            message,
            metadata,
          })),
          mapProcessingError("load feedback receipt")
        ),
      }).pipe(W.Activity.retry({ times: 3 }));

      const assessment = yield* W.Activity.make({
        name: "AssessFeedback",
        success: S.Struct({
          digest: S.String,
          excerpts: S.Array(S.String),
          customerNeed: S.NullOr(S.String),
          tone: S.NullOr(S.Literals(["NEGATIVE", "NEUTRAL", "POSITIVE"])),
          priority: S.NullOr(S.Literals(["LOW", "MEDIUM", "HIGH", "CRITICAL"])),
          interpretationConfidence: S.NullOr(S.Number),
          proposal: S.Struct({
            action: S.Literals(["CREATE_POST", "LINK_POST", "REVIEW"]),
            title: S.NullOr(S.String),
            body: S.NullOr(S.String),
            boardId: S.NullOr(S.String),
            postId: S.NullOr(S.String),
            rationale: S.NullOr(S.String),
          }),
        }),
        error: FeedbackProcessingErrors,
        execute: FeedbackAssessor.pipe(
          Effect.flatMap((assessor) => assessor.assess(receipt)),
          mapProcessingError("assess feedback")
        ),
      });

      yield* W.Activity.make({
        name: "SaveFeedbackTriageItem",
        success: S.Void,
        error: FeedbackProcessingErrors,
        execute: transaction(
          FeedbackIngestionRepository.pipe(
            Effect.flatMap((repository) =>
              repository.persistAssessment({
                ...payload,
                assessment,
              })
            )
          )
        ).pipe(mapProcessingError("save feedback triage item")),
      }).pipe(W.Activity.retry({ times: 3 }));
    });

    yield* processFeedback.pipe(
      Effect.tapError((error) =>
        transaction(
          FeedbackIngestionRepository.pipe(
            Effect.flatMap((repository) =>
              repository.markProcessingFailed({
                ...payload,
                message: describeProcessingError(error),
              })
            )
          )
        ).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("Failed to record ingestion failure", cause)
          )
        )
      )
    );

    yield* Effect.logInfo("Feedback is ready for triage");
  })
);
