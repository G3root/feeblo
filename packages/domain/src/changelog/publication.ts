import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { EmailOutboxRepository } from "../email-outbox/repository";
import { EntitlementPolicy } from "../entitlement/policies";
import { NotificationService } from "../notification/service";
import { InternalServerError } from "../rpc-errors";

/** How long a publication intent may wait for delivery before it expires. */
const PUBLISHED_INTENT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

type TRecordPublishedIntent = {
  readonly changelogId: string;
  readonly organizationId: string;
};

type TNotifyPublished = {
  readonly actorUserId?: string | null;
  readonly changelogId: string;
  readonly changelogSlug: string;
  readonly organizationId: string;
  readonly title: string;
};

/**
 * What publishing a changelog entry does besides writing the row.
 *
 * Shared by the dashboard write path and the Public API, so publishing from an
 * integration reaches subscribers exactly as publishing from the editor does:
 * a durable email intent in the outbox, and an in-app notification for every
 * subscriber. A second implementation would drift, and the drift would be a
 * release note nobody received.
 *
 * It is a plain `Effect` rather than a `Context.Service` because both callers
 * already hold the two repositories it needs at construction time, and the
 * notification service stays optional in the same way it is optional in the
 * dashboard handlers: a composition without one publishes silently to in-app
 * subscribers rather than failing a write because a notification could not be
 * delivered.
 */
export const makeChangelogPublication = Effect.gen(function* () {
  const emailOutbox = yield* EmailOutboxRepository;
  const entitlementPolicy = yield* EntitlementPolicy;
  const notifications = yield* Effect.serviceOption(NotificationService);

  /**
   * Records the durable email intent for an entry that just became published.
   *
   * Returns the outbox id to wake after the transaction commits, or
   * `undefined` when the workspace's plan does not include subscriber emails —
   * in which case the write still succeeds and the entry is published.
   *
   * The intent is written in the caller's transaction, so a status change
   * cannot commit while its intent does not: a published entry without an
   * intent would be one the subscribers were silently never told about.
   */
  const recordPublishedIntent = Effect.fn(
    "Changelog.recordPublishedEmailIntent"
  )(function* ({ changelogId, organizationId }: TRecordPublishedIntent) {
    const mayMaterialize = yield* entitlementPolicy.mayMaterializeEmailIntent({
      organizationId,
      kind: "changelog.published",
    });
    if (!mayMaterialize) {
      return undefined;
    }

    const now = yield* DateTime.nowAsDate;
    const result = yield* emailOutbox
      .recordIntent({
        aggregateId: changelogId,
        aggregateType: "changelog",
        deduplicationKey: `changelog.published:${changelogId}`,
        expiresAt: DateTime.fromDateUnsafe(now).pipe(
          DateTime.addDuration(Duration.millis(PUBLISHED_INTENT_RETENTION_MS)),
          DateTime.toDate
        ),
        kind: "changelog.published",
        organizationId,
        payload: {
          kind: "changelog.published",
          changelogId,
        },
        scheduledAt: now,
      })
      .pipe(
        Effect.tapError((error) =>
          Effect.logError(
            "Failed to record changelog publication email intent",
            error
          ).pipe(Effect.annotateLogs({ changelogId, organizationId }))
        ),
        Effect.mapError(
          () =>
            new InternalServerError({
              message: "Failed to record changelog publication email intent",
            })
        )
      );
    return result._tag === "Inserted" ? result.intent.id : undefined;
  });

  /** In-app notification for subscribed members; email stays outbox-driven. */
  const notifyPublished = (args: TNotifyPublished) =>
    Option.match(notifications, {
      onNone: () => Effect.void,
      onSome: (service) => service.notifyChangelogPublished(args),
    });

  return { notifyPublished, recordPublishedIntent };
});
