import { Database, schema, transaction } from "@feeblo/db";
import {
  MailDeliveryError,
  Mailer,
  MailTemplateRenderError,
} from "@feeblo/transactional/mailer";
import { createNotificationEmail } from "@feeblo/transactional/templates/notification";
import { and, eq, inArray } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as S from "effect/Schema";
import * as W from "effect/unstable/workflow";

class SubmissionNotificationDataError extends S.TaggedErrorClass<SubmissionNotificationDataError>()(
  "SubmissionNotificationDataError",
  {
    operation: S.String,
    cause: S.Defect,
  }
) {}

const WorkflowError = S.Union([
  MailTemplateRenderError,
  MailDeliveryError,
  SubmissionNotificationDataError,
]);

export const SubmissionEmailNotificationWorkflow = W.Workflow.make({
  name: "SubmissionEmailNotificationWorkflow",
  payload: {
    batchId: S.String,
    organizationId: S.String,
  },
  error: WorkflowError,
  idempotencyKey: ({ batchId }) => batchId,
});

const releaseBatch = ({
  batchId,
  organizationId,
}: {
  batchId: string;
  organizationId: string;
}) =>
  Effect.gen(function* () {
    const db = yield* Database.Database;

    yield* db
      .delete(schema.submissionNotificationBatchTable)
      .where(
        and(
          eq(schema.submissionNotificationBatchTable.id, batchId),
          eq(
            schema.submissionNotificationBatchTable.organizationId,
            organizationId
          )
        )
      )
      .pipe(Effect.asVoid);
  });

export const scheduleSubmissionNotificationBatch = (organizationId: string) =>
  Effect.gen(function* () {
    const db = yield* Database.Database;
    const pending = yield* db
      .select({ postId: schema.submissionNotificationQueueTable.postId })
      .from(schema.submissionNotificationQueueTable)
      .where(
        eq(
          schema.submissionNotificationQueueTable.organizationId,
          organizationId
        )
      )
      .limit(1);

    if (pending.length === 0) {
      return;
    }

    const batchId = crypto.randomUUID();
    const inserted = yield* db
      .insert(schema.submissionNotificationBatchTable)
      .values({ id: batchId, organizationId })
      .onConflictDoNothing()
      .returning({ id: schema.submissionNotificationBatchTable.id });

    if (inserted.length === 0) {
      return;
    }

    yield* SubmissionEmailNotificationWorkflow.execute(
      { batchId, organizationId },
      { discard: true }
    ).pipe(
      Effect.catchCause((cause) =>
        Effect.ignore(releaseBatch({ batchId, organizationId })).pipe(
          Effect.andThen(Effect.failCause(cause))
        )
      )
    );
  });

const mapDataError =
  (operation: string) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    Effect.mapError(
      effect,
      (cause) => new SubmissionNotificationDataError({ operation, cause })
    );

export const SubmissionEmailNotificationWorkflowLayer =
  SubmissionEmailNotificationWorkflow.toLayer(
    Effect.fnUntraced(function* (payload, executionId) {
      yield* Effect.annotateLogsScoped({
        organizationId: payload.organizationId,
        batchId: payload.batchId,
        executionId,
      });

      yield* W.DurableClock.sleep({
        name: `submission-notification-cool-down-${payload.batchId}`,
        duration: "15 minutes",
      });

      const deliveredPostIds = yield* W.Activity.make({
        name: "SendSubmissionNotificationEmail",
        success: S.Array(S.String),
        error: WorkflowError,

        execute: Effect.gen(function* () {
          const mailer = yield* Mailer;
          const db = yield* Database.Database;

          const posts = yield* db.query.submissionNotificationQueueTable
            .findMany({
              where: {
                organizationId: payload.organizationId,
              },
              with: {
                post: {
                  columns: {
                    id: true,
                    slug: true,
                    title: true,
                  },
                  with: {
                    board: {
                      columns: {
                        slug: true,
                      },
                    },
                  },
                },
              },
            })
            .pipe(mapDataError("query submission notification queue"));

          const queuedPosts = posts.flatMap(({ post }) =>
            post
              ? [
                  {
                    id: post.id,
                    label: post.title,
                    url: `https://app.feeblo.com/${payload.organizationId}/post/${post.board?.slug ?? ""}/${post.slug}`,
                  },
                ]
              : []
          );

          if (queuedPosts.length === 0) {
            return [];
          }

          const members = yield* db.query.memberTable
            .findMany({
              where: {
                organizationId: payload.organizationId,
              },
              with: {
                user: {
                  columns: {
                    email: true,
                  },
                },
              },
            })
            .pipe(mapDataError("query submission notification recipients"));

          const emails = members
            .map(({ user }) => user?.email)
            .filter((email): email is string => typeof email === "string");

          yield* Effect.forEach(
            emails,
            (to) =>
              mailer.send({
                ...createNotificationEmail({
                  title: `New submission${queuedPosts.length > 1 ? "s" : ""} in your workspace`,
                  body:
                    queuedPosts.length === 1
                      ? "A new post has been submitted."
                      : `${queuedPosts.length} new posts have been submitted.`,
                  eyebrow: "Feedback",
                  actionLabel: "View dashboard",
                  actionUrl: "https://app.feeblo.com",
                  posts: queuedPosts,
                  unsubscribeUrl:
                    "https://app.feeblo.com/settings/notifications",
                }),
                messageId: `<submission.${payload.batchId}.${encodeURIComponent(to)}@notifications.feeblo>`,
                to,
              }),
            { concurrency: 5 }
          );

          return queuedPosts.map(({ id }) => id);
        }),
      }).pipe(
        W.Activity.retry({ times: 3 }),
        Effect.tapError((error) =>
          Effect.logError("SendSubmissionNotificationEmail failed").pipe(
            Effect.annotateLogs({
              error: String(error),
              organizationId: payload.organizationId,
            })
          )
        ),
        Effect.catch((error) =>
          Effect.ignore(releaseBatch(payload)).pipe(
            Effect.andThen(Effect.fail(error))
          )
        )
      );

      yield* transaction(
        Effect.gen(function* () {
          const db = yield* Database.Database;

          if (deliveredPostIds.length > 0) {
            yield* db
              .delete(schema.submissionNotificationQueueTable)
              .where(
                inArray(
                  schema.submissionNotificationQueueTable.postId,
                  deliveredPostIds
                )
              );
          }

          yield* releaseBatch(payload);
        })
      ).pipe(
        mapDataError("complete submission notification batch"),
        Effect.catch((error) =>
          Effect.ignore(releaseBatch(payload)).pipe(
            Effect.andThen(Effect.fail(error))
          )
        )
      );

      yield* scheduleSubmissionNotificationBatch(payload.organizationId).pipe(
        mapDataError("schedule next submission notification batch")
      );
    })
  );
