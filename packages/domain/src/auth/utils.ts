import { symmetricDecrypt, symmetricEncrypt } from "@feeblo/utils/crypto";
import { Duration, Effect, Schema } from "effect";
import {
  type VerificationOTPState,
  VerificationOTPStateSchema,
} from "./schema";

const EmailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const VERIFICATION_OTP_COOKIE_NAME = "verification_otp";

export const encryptVerificationOTPState = (
  state: VerificationOTPState,
  secret: string
) =>
  Effect.tryPromise({
    try: () =>
      symmetricEncrypt({
        key: secret,
        data: JSON.stringify(state),
      }),
    catch: () => new Error("Failed to encrypt verification OTP state"),
  });

const decryptVerificationOTPState = (data: string, secret: string) =>
  Effect.tryPromise({
    try: () =>
      symmetricDecrypt({
        key: secret,
        data,
      }),
    catch: () => new Error("Failed to decrypt verification OTP state"),
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
      Effect.try({
        try: () => JSON.parse(decrypted),
        catch: () => new Error("Failed to parse verification OTP state"),
      })
    ),
    Effect.flatMap((parsed) =>
      Schema.decodeUnknown(VerificationOTPStateSchema)(parsed).pipe(
        Effect.mapError(() => new Error("Invalid verification OTP state"))
      )
    ),
    Effect.flatMap((state) =>
      isValidVerificationOTPEmail(state.email)
        ? Effect.succeed({
            ...state,
            email: state.email.toLowerCase(),
          })
        : Effect.fail(new Error("Invalid verification OTP state"))
    )
  );

export const isValidVerificationOTPEmail = (email: string) =>
  EmailRegex.test(email);
