import { symmetricDecrypt, symmetricEncrypt } from "@feeblo/utils/crypto";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  type VerificationOTPState,
  VerificationOTPStateSchema,
} from "./schema";

const EmailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const VERIFICATION_OTP_COOKIE_NAME = "verification_otp";

const VerificationOTPStateFromJson = Schema.fromJsonString(
  VerificationOTPStateSchema
);

class VerificationOTPEncryptionError extends Schema.TaggedErrorClass<VerificationOTPEncryptionError>()(
  "VerificationOTPEncryptionError",
  {
    cause: Schema.Defect,
  }
) {}

class VerificationOTPDecryptionError extends Schema.TaggedErrorClass<VerificationOTPDecryptionError>()(
  "VerificationOTPDecryptionError",
  {
    cause: Schema.Defect,
  }
) {}

class InvalidVerificationOTPStateError extends Schema.TaggedErrorClass<InvalidVerificationOTPStateError>()(
  "InvalidVerificationOTPStateError",
  {
    cause: Schema.optional(Schema.Defect),
  }
) {}

export const encryptVerificationOTPState = (
  state: VerificationOTPState,
  secret: string
) =>
  Schema.encodeEffect(VerificationOTPStateFromJson)(state).pipe(
    Effect.mapError((cause) => new InvalidVerificationOTPStateError({ cause })),
    Effect.flatMap((data) =>
      Effect.tryPromise({
        try: () =>
          symmetricEncrypt({
            key: secret,
            data,
          }),
        catch: (cause) => new VerificationOTPEncryptionError({ cause }),
      })
    )
  );

const decryptVerificationOTPState = (data: string, secret: string) =>
  Effect.tryPromise({
    try: () =>
      symmetricDecrypt({
        key: secret,
        data,
      }),
    catch: (cause) => new VerificationOTPDecryptionError({ cause }),
  });

export const generateVerificationOTPCookieData = (isSecure: boolean) => ({
  name: VERIFICATION_OTP_COOKIE_NAME,
  attributes: {
    maxAge: Duration.minutes(10),
    sameSite: "lax" as const,
    path: "/",
    httpOnly: true,
    secure: isSecure,
  },
});

export const getCookieVerificationOTPState = (data: string, secret: string) =>
  decryptVerificationOTPState(data, secret).pipe(
    Effect.flatMap((decrypted) =>
      Schema.decodeUnknownEffect(VerificationOTPStateFromJson)(decrypted).pipe(
        Effect.mapError(
          (cause) => new InvalidVerificationOTPStateError({ cause })
        )
      )
    ),
    Effect.flatMap((state) =>
      isValidVerificationOTPEmail(state.email)
        ? Effect.succeed({
            ...state,
            email: state.email.toLowerCase(),
          })
        : Effect.fail(new InvalidVerificationOTPStateError({}))
    )
  );

export const isValidVerificationOTPEmail = (email: string) =>
  EmailRegex.test(email);
