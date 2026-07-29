import { Database, transaction } from "@feeblo/db";
import { PostId } from "@feeblo/id";
import { htmlToExcerpt } from "@feeblo/utils/html";
import { sanitizeMarkdown } from "@feeblo/utils/markdown-sanitizer";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
import * as WorkflowEngine from "effect/unstable/workflow/WorkflowEngine";
import { PostRepository } from "../post/repository";
import { PostActivityRepository } from "../post-activity/repository";
import { BadRequestError } from "../rpc-errors";
import { UpvoteRepository } from "../upvote/repository";
import { FeedbackIngestionRepository } from "./repository";
import type {
  TCaptureFeedback,
  TFeedbackChannelKind,
  TFeedbackTriageCreatePost,
  TFeedbackTriageIgnore,
  TFeedbackTriageLinkPost,
} from "./schema";
import { FeedbackIngestionWorkflow } from "./workflow";

const postSourceFor = (
  source: TFeedbackChannelKind
): "DASHBOARD" | "WIDGET" | "API" | "IMPORT" | "PUBLIC_BOARD" => {
  switch (source) {
    case "DASHBOARD":
      return "DASHBOARD";
    case "WIDGET":
      return "WIDGET";
    case "PUBLIC_PORTAL":
      return "PUBLIC_BOARD";
    case "CSV_IMPORT":
      return "IMPORT";
    default:
      return "API";
  }
};

const validateCaptureInput = (input: TCaptureFeedback) =>
  Effect.gen(function* () {
    if (!input.message.text.trim()) {
      return yield* new BadRequestError({
        message: "Feedback content cannot be empty",
      });
    }
    if (!(input.deliveryKey.trim() && input.channel.key.trim())) {
      return yield* new BadRequestError({
        message: "Channel key and delivery key are required",
      });
    }
  });

const makeFeedbackIngestionService = Effect.gen(function* () {
  const db = yield* Database.Database;
  const repository = yield* FeedbackIngestionRepository;
  const workflowEngine = yield* WorkflowEngine.WorkflowEngine;
  const inTransaction = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    transaction(effect).pipe(Effect.provideService(Database.Database, db));
  const drainPendingDispatches = Effect.fn(
    "FeedbackIngestionService.drainPendingDispatches"
  )(function* () {
    const pending = yield* repository.listPendingWorkflowDispatches({
      limit: 100,
    });
    yield* Effect.forEach(
      pending,
      ({ organizationId, receiptId }) =>
        FeedbackIngestionWorkflow.execute(
          { organizationId, receiptId },
          { discard: true }
        ).pipe(
          Effect.provideService(WorkflowEngine.WorkflowEngine, workflowEngine),
          Effect.tap(() =>
            repository.recordWorkflowDispatchAttempt({
              receiptId,
              result: "succeeded",
            })
          ),
          Effect.tapError(() =>
            repository.recordWorkflowDispatchAttempt({
              receiptId,
              result: "failed",
            })
          ),
          Effect.annotateLogs({ organizationId, receiptId })
        ),
      { concurrency: 1 }
    );
  });

  return {
    drainPendingDispatches,

    captureAttached: Effect.fn(
      "FeedbackIngestionService.captureAttached"
    )(function* (
      input: TCaptureFeedback & { readonly attachedPostId: string }
    ) {
      yield* validateCaptureInput(input);
      const { attachedPostId, ...capture } = input;
      const result = yield* inTransaction(
        Effect.gen(function* () {
          const postIsAttachable = yield* repository.isPostAttachable({
            organizationId: input.organizationId,
            postId: attachedPostId,
          });
          if (!postIsAttachable) {
            return yield* new BadRequestError({
              message: "Attached post does not belong to this workspace",
            });
          }
          return yield* repository.captureIdempotently(capture, {
            attachedPostId,
          });
        })
      );
      return yield* Effect.succeed(result).pipe(
        Effect.annotateLogs({
          attachedPostId,
          channelKind: input.channel.kind,
          channelKey: input.channel.key,
          organizationId: input.organizationId,
          receiptId: result.receiptId,
        })
      );
    }),

    capture: Effect.fn("FeedbackIngestionService.capture")(function* (
      input: TCaptureFeedback
    ) {
      yield* validateCaptureInput(input);

      const result = yield* inTransaction(repository.captureIdempotently(input));

      yield* drainPendingDispatches();

      return yield* Effect.succeed(result).pipe(
        Effect.annotateLogs({
          channelKind: input.channel.kind,
          channelKey: input.channel.key,
          organizationId: input.organizationId,
          receiptId: result.receiptId,
        })
      );
    }),
  };
});

export class FeedbackIngestionService extends Context.Service<FeedbackIngestionService>()(
  "FeedbackIngestionService",
  { make: makeFeedbackIngestionService }
) {
  static readonly layer = Layer.effect(this, this.make);
}

export const FeedbackIngestionRecoveryLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const ingestion = yield* FeedbackIngestionService;
    yield* ingestion.drainPendingDispatches().pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("Feedback ingestion recovery pass failed", cause)
      ),
      Effect.repeat(Schedule.spaced("30 seconds")),
      Effect.forkScoped
    );
  })
);

const makeFeedbackTriageService = Effect.gen(function* () {
  const db = yield* Database.Database;
  const repository = yield* FeedbackIngestionRepository;
  const posts = yield* PostRepository;
  const upvotes = yield* UpvoteRepository;
  const activities = yield* PostActivityRepository;
  const inTransaction = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    transaction(effect).pipe(Effect.provideService(Database.Database, db));

  return {
    createPost: Effect.fn("FeedbackTriageService.createPost")(function* (
      input: TFeedbackTriageCreatePost & {
        readonly actorId: string;
        readonly memberId: string;
      }
    ) {
      const postId = yield* PostId.generate;

      yield* inTransaction(
        Effect.gen(function* () {
          const triageItem =
            yield* repository.getOpenTriageItemForUpdate(input);
          const targetIsValid = yield* repository.validatePostTarget(input);
          if (!targetIsValid) {
            return yield* new BadRequestError({
              message:
                "The selected board or status does not belong to this workspace",
            });
          }

          const title = (input.title ?? triageItem.proposedTitle ?? "").trim();
          const content = (
            input.content ??
            triageItem.proposedBody ??
            ""
          ).trim();
          if (!(title && content)) {
            return yield* new BadRequestError({
              message: "A title and content are required to create a post",
            });
          }

          const { sanitizedMarkdown, sanitizedHtml } =
            sanitizeMarkdown(content);
          yield* posts.create({
            id: postId,
            organizationId: input.organizationId,
            boardId: input.boardId,
            statusId: input.statusId,
            title,
            content: sanitizedMarkdown,
            excerpt: htmlToExcerpt(sanitizedHtml),
            creatorId: input.actorId,
            creatorMemberId: input.memberId,
            contactId: triageItem.contactId,
            source: postSourceFor(triageItem.channelKind),
          });
          yield* activities.create({
            organizationId: input.organizationId,
            postId,
            actorId: input.actorId,
            actorMemberId: input.memberId,
            kind: "POST_CREATED",
          });
          yield* activities.create({
            organizationId: input.organizationId,
            postId,
            actorId: input.actorId,
            actorMemberId: input.memberId,
            kind: "FEEDBACK_ATTACHED",
            nextValue: triageItem.receiptId,
          });
          yield* posts.enqueueSubmissionNotification({
            organizationId: input.organizationId,
            postId,
          });
          yield* repository.completeTriageItem({
            organizationId: input.organizationId,
            triageItemId: input.triageItemId,
            status: "POST_CREATED",
            resolvedPostId: postId,
            decidedByMemberId: input.memberId,
          });
        })
      );

      yield* posts
        .scheduleSubmissionNotification(input.organizationId)
        .pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning(
              "Failed to schedule feedback submission notification",
              cause
            )
          )
        );

      return { status: "POST_CREATED", postId } as const;
    }),

    linkPost: Effect.fn("FeedbackTriageService.linkPost")(function* (
      input: TFeedbackTriageLinkPost & {
        readonly actorId: string;
        readonly memberId: string;
      }
    ) {
      yield* inTransaction(
        Effect.gen(function* () {
          const triageItem =
            yield* repository.getOpenTriageItemForUpdate(input);
          const postIsAttachable = yield* repository.isPostAttachable(input);
          if (!postIsAttachable) {
            return yield* new BadRequestError({
              message: "The selected post does not belong to this workspace",
            });
          }

          if (triageItem.contactId) {
            yield* upvotes.addOnBehalf({
              organizationId: input.organizationId,
              postId: input.postId,
              contactId: triageItem.contactId,
              addedByMemberId: input.memberId,
            });
          }
          yield* activities.create({
            organizationId: input.organizationId,
            postId: input.postId,
            actorId: input.actorId,
            actorMemberId: input.memberId,
            kind: "FEEDBACK_ATTACHED",
            nextValue: triageItem.receiptId,
          });
          yield* repository.completeTriageItem({
            organizationId: input.organizationId,
            triageItemId: input.triageItemId,
            status: "POST_LINKED",
            resolvedPostId: input.postId,
            decidedByMemberId: input.memberId,
          });
        })
      );

      return {
        status: "POST_LINKED",
        postId: input.postId,
      } as const;
    }),

    ignore: Effect.fn("FeedbackTriageService.ignore")(function* (
      input: TFeedbackTriageIgnore & {
        readonly memberId: string;
      }
    ) {
      yield* inTransaction(
        Effect.gen(function* () {
          yield* repository.getOpenTriageItemForUpdate(input);
          yield* repository.completeTriageItem({
            organizationId: input.organizationId,
            triageItemId: input.triageItemId,
            status: "IGNORED",
            resolvedPostId: null,
            decidedByMemberId: input.memberId,
          });
        })
      );

      return { status: "IGNORED", postId: null } as const;
    }),
  };
});

export class FeedbackTriageService extends Context.Service<FeedbackTriageService>()(
  "FeedbackTriageService",
  { make: makeFeedbackTriageService }
) {
  static readonly layer = Layer.effect(this, this.make);
}
