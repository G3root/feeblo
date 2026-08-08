import { EmailEventId } from "@feeblo/id";
import {
  MailDeliveryError,
  Mailer,
  MailTemplateRenderError,
} from "@feeblo/transactional/mailer";
import { createPostStatusChangedEmail } from "@feeblo/transactional/templates/post-status-changed";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as S from "effect/Schema";
import * as W from "effect/unstable/workflow";

import { EmailConfig } from "./config";
import { EmailEventRepository } from "./repository";
import { fallbackUnsubscribeUrl, signUnsubscribeToken } from "./unsubscribe";

class EmailEventDataError extends S.TaggedErrorClass<EmailEventDataError>()(
  "EmailEventDataError",
  {
    operation: S.String,
    cause: S.Defect(),
  }
) {}

const WorkflowError = S.Union([
  MailTemplateRenderError,
  MailDeliveryError,
  EmailEventDataError,
]);

const DispatcherResult = S.Struct({
  claimed: S.Boolean,
  delivered: S.Number,
  failed: S.Number,
  held: S.Number,
  skipped: S.Number,
  suppressed: S.Number,
});

export const PostStatusChangedEmailWorkflow = W.Workflow.make(
  "PostStatusChangedEmailWorkflow",
  {
    payload: {
      eventId: S.String,
      organizationId: S.String,
    },
    error: WorkflowError,
    idempotencyKey: ({ eventId }) => eventId,
  }
);

const mapDataError =
  (operation: string) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    Effect.mapError(
      effect,
      (cause) => new EmailEventDataError({ operation, cause })
    );

/**
 * Schedules the status-change workflow for an event row. Safe to call
 * repeatedly: workflow execution ids derive from the event id, so concurrent
 * or repeated schedules collapse onto one execution (the engine dedupes).
 */
export const PostStatusChangedEmailWorkflowLayer =
  PostStatusChangedEmailWorkflow.toLayer(
    Effect.fnUntraced(function* (payload, executionId) {
      yield* Effect.annotateLogsScoped({
        kind: "post_status_changed",
        organizationId: payload.organizationId,
        eventId: payload.eventId,
        executionId,
      });

      const config = yield* EmailConfig;
      const repository = yield* EmailEventRepository;

      yield* W.DurableClock.sleep({
        name: `post-status-changed-digest-${payload.eventId}`,
        duration: config.digestWindow,
      });

      const result = yield* W.Activity.make({
        name: "SendPostStatusChangedEmail",
        success: DispatcherResult,
        error: WorkflowError,

        execute: Effect.gen(function* () {
          const mailer = yield* Mailer;

          const claimed = yield* repository
            .claim(payload.eventId)
            .pipe(mapDataError("claim email event"));

          if (!claimed) {
            return DispatcherResult.make({
              claimed: false,
              delivered: 0,
              failed: 0,
              held: 0,
              skipped: 0,
              suppressed: 0,
            });
          }

          const row = yield* repository
            .findById(payload.eventId)
            .pipe(mapDataError("read email event"));

          if (!row) {
            return DispatcherResult.make({
              claimed: true,
              delivered: 0,
              failed: 0,
              held: 0,
              skipped: 0,
              suppressed: 0,
            });
          }

          const eventPayload = row.payload;
          if (eventPayload.kind !== "post_status_changed") {
            return yield* new EmailEventDataError({
              operation: "dispatch",
              cause: new Error(
                `Unsupported email event kind: ${eventPayload.kind}`
              ),
            });
          }

          const recipients = yield* repository
            .resolveRecipients({
              actorUserId: eventPayload.actorUserId,
              organizationId: eventPayload.organizationId,
              postId: eventPayload.postId,
            })
            .pipe(mapDataError("resolve email recipients"));

          const suppressed = yield* repository
            .findSuppressed(recipients.map((recipient) => recipient.email))
            .pipe(mapDataError("read suppressed emails"));

          const capSince = new Date(
            Date.now() - Duration.toMillis(Duration.days(1))
          );

          const outcomes = yield* Effect.forEach(
            recipients,
            (recipient) =>
              Effect.gen(function* () {
                // Crash-restart guard: never re-send a recipient that already
                // has a `sent` delivery row for this event.
                const alreadySent = yield* repository
                  .hasSentDelivery(payload.eventId, recipient.email)
                  .pipe(mapDataError("check email delivery guard"));

                if (alreadySent) {
                  return "skipped" as const;
                }

                if (suppressed.has(recipient.email.toLowerCase())) {
                  yield* repository
                    .upsertDelivery({
                      eventId: payload.eventId,
                      organizationId: eventPayload.organizationId,
                      memberId: recipient.memberId,
                      recipient: recipient.email,
                      template: "post-status-changed",
                      status: "suppressed",
                    })
                    .pipe(mapDataError("record suppressed email delivery"));
                  return "suppressed" as const;
                }

                // Daily frequency cap: over-cap recipients are held, never
                // dropped — no delivery row is recorded and the event is
                // recycled (see below) so they are re-attempted later.
                const sentToday = yield* repository
                  .sentCountSince(recipient.email, capSince)
                  .pipe(mapDataError("count recent email deliveries"));

                if (sentToday >= config.dailyCapPerRecipient) {
                  return "held" as const;
                }

                const messageId = `<email-event.${payload.eventId}.${encodeURIComponent(recipient.email)}@notifications.feeblo>`;

                // Stateless unsubscribe link: token minted per recipient, or
                // the settings fallback when no signing secret is configured.
                const unsubscribeToken =
                  recipient.memberId === null
                    ? null
                    : yield* signUnsubscribeToken(
                        recipient.memberId,
                        eventPayload.postId
                      );
                const unsubscribeUrl =
                  unsubscribeToken === null
                    ? fallbackUnsubscribeUrl
                    : `https://app.feeblo.com/api/email/unsubscribe?token=${encodeURIComponent(unsubscribeToken)}`;

                const sendResult = yield* mailer
                  .send({
                    ...createPostStatusChangedEmail({
                      postTitle: eventPayload.postTitle,
                      postUrl: eventPayload.postUrl,
                      changes: eventPayload.changes.map((change) => ({
                        previousStatusLabel: change.previousStatusLabel,
                        nextStatusLabel: change.nextStatusLabel,
                      })),
                      unsubscribeUrl,
                    }),
                    messageId,
                    to: recipient.email,
                  })
                  .pipe(
                    Effect.catch((error) =>
                      repository
                        .upsertDelivery({
                          eventId: payload.eventId,
                          organizationId: eventPayload.organizationId,
                          memberId: recipient.memberId,
                          recipient: recipient.email,
                          template: "post-status-changed",
                          status: "failed",
                          error: String(error),
                        })
                        .pipe(
                          mapDataError("record failed email delivery"),
                          Effect.as("failed" as const)
                        )
                    )
                  );

                if (sendResult === "failed") {
                  return sendResult;
                }

                yield* repository
                  .upsertDelivery({
                    eventId: payload.eventId,
                    organizationId: eventPayload.organizationId,
                    memberId: recipient.memberId,
                    recipient: recipient.email,
                    template: "post-status-changed",
                    status: "sent",
                    providerMessageId: messageId,
                  })
                  .pipe(mapDataError("record sent email delivery"));

                return "delivered" as const;
              }),
            { concurrency: 5 }
          );

          const tally = (
            tag: "delivered" | "failed" | "held" | "skipped" | "suppressed"
          ) => outcomes.filter((outcome) => outcome === tag).length;

          // Failure isolation: per-recipient errors never abort the batch, but
          // any failure fails the activity so the outbox retry policy
          // re-attempts it (the `sent` guard skips already-delivered rows).
          const failed = tally("failed");
          if (failed > 0) {
            return yield* new EmailEventDataError({
              operation: "deliver",
              cause: new Error(`${failed} recipient(s) failed to deliver`),
            });
          }

          return DispatcherResult.make({
            claimed: true,
            delivered: tally("delivered"),
            failed: 0,
            held: tally("held"),
            skipped: tally("skipped"),
            suppressed: tally("suppressed"),
          });
        }),
      }).pipe(
        W.Activity.retry({ times: 3 }),
        Effect.tapError((error) =>
          Effect.logError("SendPostStatusChangedEmail failed").pipe(
            Effect.annotateLogs({ error: String(error) })
          )
        ),
        Effect.catch((error) =>
          repository
            .complete(payload.eventId, "failed", String(error))
            .pipe(Effect.ignore, Effect.andThen(Effect.fail(error)))
        )
      );

      // Already claimed by a resumed execution — nothing left to do.
      if (!result.claimed) {
        return;
      }

      const row = yield* repository
        .findById(payload.eventId)
        .pipe(mapDataError("read email event after dispatch"), Effect.orDie);

      // Held recipients (over daily cap): recycle into a fresh event row with
      // a delayed `available_at` — "held and coalesced, never dropped". The
      // reaper (or the next schedule call) picks the fresh row up later.
      if (result.held > 0 && row) {
        if (repository.isOverMaxAttempts(row.attempts)) {
          yield* repository
            .complete(payload.eventId, "failed", "held beyond max attempts")
            .pipe(Effect.ignore);
          yield* Effect.logWarning(
            "Email event dead-lettered after repeated holds",
            {
              eventId: payload.eventId,
              attempts: row.attempts,
            }
          );
          return;
        }

        const nextEventId = yield* EmailEventId.generate.pipe(Effect.orDie);
        yield* repository
          .recycle(row, {
            availableAt: new Date(
              Date.now() + Duration.toMillis(config.digestWindow)
            ),
            error: "held: daily email cap exceeded",
            nextEventId,
          })
          .pipe(
            mapDataError("recycle held email event"),
            Effect.catch((error) =>
              Effect.logWarning("Failed to recycle held email event", { error })
            )
          );
        yield* repository
          .scheduleEvent(nextEventId, payload.organizationId)
          .pipe(
            Effect.catchCause((cause) =>
              Effect.logWarning(
                "Failed to schedule recycled email event",
                cause
              )
            )
          );
        return;
      }

      yield* repository
        .complete(payload.eventId, "sent")
        .pipe(mapDataError("complete email event"), Effect.orDie);
    })
  );
