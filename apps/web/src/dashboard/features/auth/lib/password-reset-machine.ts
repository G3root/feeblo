import * as Schema from "effect/Schema";
import { setup } from "xstate";

/**
 * The lifecycle of a password reset, as an XState machine.
 *
 * Two `useState` calls held this before: the step, and the code the first step
 * verified. They had to be written together — `setOtp(nextOtp)` and
 * `setStep("password")` — and nothing said so, so the password form could
 * exist holding whatever the last render left in `otp`. Here the code lives in
 * the context of the state that needs it, and the only way to reach `password`
 * is a `VERIFIED` event that carries one.
 *
 * The graph has one back-edge, and it is the reason this is worth declaring:
 * a code that expires or runs out of attempts *while the user is choosing a
 * password* sends them back to `otp`. That rule lived inside an error branch in
 * the submit handler, next to three toast strings, where it read as one of
 * several failure cases rather than as a transition.
 */

type PasswordResetContext = {
  /** The code the OTP step verified. Empty in `otp`. */
  readonly otp: string;
};

const ContextSchema = Schema.toStandardSchemaV1(
  Schema.Struct({ otp: Schema.String })
);

const VerifiedEventSchema = Schema.toStandardSchemaV1(
  Schema.Struct({ otp: Schema.String, type: Schema.Literal("VERIFIED") })
);

const CodeRejectedEventSchema = Schema.toStandardSchemaV1(
  Schema.Struct({ type: Schema.Literal("CODE_REJECTED") })
);

export const passwordResetMachine = setup({
  schemas: {
    context: ContextSchema,
    events: {
      CODE_REJECTED: CodeRejectedEventSchema,
      VERIFIED: VerifiedEventSchema,
    },
  },
}).createMachine({
  context: { otp: "" },
  id: "passwordReset",
  initial: "otp",
  states: {
    otp: {
      on: {
        VERIFIED: {
          context: ({ event }: { event: { otp: string } }) => ({
            otp: event.otp,
          }),
          target: "password",
        },
      },
    },
    password: {
      on: {
        // The code the first step verified is no longer usable. Staying here
        // would fail every submit with the same error, so the back-edge is the
        // only useful answer — and it clears the code, because the next
        // `VERIFIED` must supply a fresh one.
        CODE_REJECTED: {
          context: { otp: "" },
          target: "otp",
        },
      },
    },
  },
});

/**
 * The two fields of a running actor's snapshot this module reads. Structural
 * rather than `SnapshotFrom<…>` because `@xstate/react` widens the snapshot's
 * `status` for its own subscribe helpers.
 */
export type PasswordResetSnapshot = {
  readonly context: PasswordResetContext;
  readonly matches: (state: string) => boolean;
};

/**
 * Collapses a snapshot into the shape the two forms render.
 *
 * `otp` is empty in the first step and never empty in the second, so a caller
 * cannot reach the password form without the code it submits.
 */
export type PasswordResetStep =
  | { readonly step: "otp" }
  | { readonly step: "password"; readonly otp: string };

export const toPasswordResetStep = (
  snapshot: PasswordResetSnapshot
): PasswordResetStep =>
  snapshot.matches("password")
    ? { otp: snapshot.context.otp, step: "password" }
    : { step: "otp" };
