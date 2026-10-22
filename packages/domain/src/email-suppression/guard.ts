import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { EmailSuppressionRepository } from "./repository";
import { EmailSuppressionDataError } from "./schema";

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
 * blocks a password reset; a hard bounce observed anywhere does.
 *
 * A lookup failure fails the send. That is deliberate: sending to an address
 * whose suppression state is unknown is the one outcome a suppression list
 * exists to prevent, and the caller's retry (or the workflow's) is the recovery.
 */
const toSuppressionDataError = (cause: unknown): EmailSuppressionDataError =>
  Schema.is(EmailSuppressionDataError)(cause)
    ? cause
    : new EmailSuppressionDataError({
        cause,
        operation: "sendUnlessSuppressed",
        reason: "database",
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
    yield* args.send;
  });
