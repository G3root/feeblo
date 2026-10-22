import { MailPermanentDeliveryError } from "@feeblo/transactional/mailer";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { EmailSuppressionRepository } from "./repository";
import { EmailSuppressionDataError } from "./schema";
import { recordEmailSuppression } from "./telemetry";

/**
 * Runs a send only when the address is not suppressed for this sender.
 *
 * The outbox checks the list immediately before submission, which is the
 * authoritative gate. This helper exists for the mail that never enters the
 * outbox — better-auth's verification, password-reset and invitation messages,
 * and the onboarding workflow — which would otherwise keep hammering an address
 * that hard-bounced or complained.
 *
 * `organizationId` is `null` for mail that belongs to no workspace, which means
 * only platform rows apply. A complaint written by a workspace therefore never
 * blocks a password reset; an invitation passes the inviting workspace, so its
 * complaints and manual blocks apply. A hard bounce observed anywhere does.
 *
 * A lookup failure fails the send. That is deliberate: sending to an address
 * whose suppression state is unknown is the one outcome a suppression list
 * exists to prevent, and the caller's retry (or the workflow's) is the recovery.
 *
 * A synchronous recipient rejection is the last chance to learn that a direct
 * send's address is dead: these messages have no delivery row, so provider
 * feedback cannot be correlated back to them. The guard records the rejection
 * before re-raising it, and a failed write never turns the rejection into a
 * retry.
 */
const toSuppressionDataError = (cause: unknown): EmailSuppressionDataError =>
  Schema.is(EmailSuppressionDataError)(cause)
    ? cause
    : new EmailSuppressionDataError({
        cause,
        operation: "sendUnlessSuppressed",
        reason: "database",
      });

/**
 * Records the address a synchronous submission rejected. Best-effort: the
 * transport error is what the caller must see, so a suppression write that
 * fails is logged and the rejection is still re-raised.
 */
const recordRejectedRecipient = (args: {
  readonly email: string;
  readonly organizationId: string | null;
}) =>
  Effect.gen(function* () {
    const suppressions = yield* EmailSuppressionRepository;
    const now = yield* DateTime.nowAsDate;
    yield* suppressions
      .upsert({
        email: args.email,
        note: null,
        now,
        organizationId: args.organizationId,
        providerEventId: null,
        reason: "hard_bounce",
      })
      .pipe(
        Effect.tap(() => recordEmailSuppression("hard_bounce", "smtp")),
        Effect.catch((cause) =>
          Effect.logError(
            "Could not record a direct-send recipient rejection as a suppression",
            cause
          )
        )
      );
  });

export const sendUnlessSuppressed = <E, R>(args: {
  readonly email: string;
  readonly organizationId: string | null;
  readonly send: Effect.Effect<void, E, R>;
}): Effect.Effect<
  void,
  E | EmailSuppressionDataError,
  R | EmailSuppressionRepository
> =>
  Effect.gen(function* () {
    const suppressions = yield* EmailSuppressionRepository;
    const suppressed = yield* suppressions
      .isSuppressed({
        email: args.email,
        organizationId: args.organizationId,
      })
      .pipe(Effect.mapError(toSuppressionDataError));
    if (suppressed) {
      yield* Effect.logWarning(
        "Email skipped because the address is suppressed"
      ).pipe(
        Effect.annotateLogs({
          organizationId: args.organizationId ?? "platform",
        })
      );
      return;
    }
    yield* args.send.pipe(
      Effect.catchIf(
        (error) =>
          Schema.is(MailPermanentDeliveryError)(error) &&
          error.failureClass === "recipient",
        (error) =>
          recordRejectedRecipient({
            email: args.email,
            organizationId: args.organizationId,
          }).pipe(Effect.andThen(Effect.fail(error)))
      )
    );
  });
