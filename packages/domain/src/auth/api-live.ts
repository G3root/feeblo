import * as Effect from "effect/Effect";
import * as Duration from "effect/Duration";
import * as HttpEffect from "effect/unstable/http/HttpEffect";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import * as HttpApiBuilder from "effect/unstable/httpapi/HttpApiBuilder";

import { Api } from "../http/api";
import * as RateLimit from "../rate-limit";
import {
  BadRequestError,
  InternalServerError,
  NotFoundError,
  withRemapDbErrors,
} from "../rpc-errors";
import { VerificationOtpConfig } from "./config";
import type { VerificationOTPState } from "./schema";
import {
  encryptVerificationOTPState,
  generateVerificationOTPCookieData,
  getCookieVerificationOTPState,
  isValidVerificationOTPEmail,
} from "./utils";

export const AuthApiLive = HttpApiBuilder.group(
  Api,
  "AuthApiGroup",
  (handlers) =>
    handlers
      .handle("postVerificationOtp", ({ payload }) =>
        postVerificationOtp(payload).pipe(
          RateLimit.withPublicHttpRateLimit({
            name: "VerificationOtpPost",
            level: "read",
          }),
          withRemapDbErrors("Otp", "create")
        )
      )
      .handle("getVerificationOtp", () =>
        getVerificationOtp().pipe(
          RateLimit.withPublicHttpRateLimit({
            name: "VerificationOtpGet",
            level: "read",
          }),
          withRemapDbErrors("Otp", "select")
        )
      )
      .handle("deleteVerificationOtp", () =>
        deleteVerificationOtp().pipe(
          RateLimit.withPublicHttpRateLimit({
            name: "VerificationOtpDelete",
            level: "read",
          }),
          withRemapDbErrors("Otp", "delete")
        )
      )
);

function postVerificationOtp(
  payload: VerificationOTPState
): Effect.Effect<
  { success: boolean },
  BadRequestError | InternalServerError,
  HttpServerRequest.HttpServerRequest
> {
  return Effect.gen(function* () {
    const { appUrl, secret } = yield* VerificationOtpConfig;

    const email = payload.email.toLowerCase();
    if (!isValidVerificationOTPEmail(email)) {
      return yield* new BadRequestError({
        message: "Invalid verification state",
      });
    }

    const encryptedState = yield* encryptVerificationOTPState(
      {
        email,
        type: payload.type,
      },
      secret
    ).pipe(
      Effect.mapError(
        () => new InternalServerError({ message: "Failed to encrypt state" })
      )
    );

    const cookieData = generateVerificationOTPCookieData(
      appUrl.startsWith("https://")
    );

    yield* HttpEffect.appendPreResponseHandler((_request, response) =>
      Effect.succeed(
        response.pipe(
          HttpServerResponse.setCookieUnsafe(
            cookieData.name,
            encryptedState,
            cookieData.attributes
          )
        )
      )
    );

    return { success: true };
  }).pipe(Effect.provide(VerificationOtpConfig.layer));
}

function getVerificationOtp(): Effect.Effect<
  { email: string; type: "email-verification" | "reset-password" },
  BadRequestError | NotFoundError | InternalServerError,
  HttpServerRequest.HttpServerRequest
> {
  return Effect.gen(function* () {
    const { secret } = yield* VerificationOtpConfig;
    const request = yield* HttpServerRequest.HttpServerRequest;
    const cookieData = generateVerificationOTPCookieData(false);
    const cookieValue = request.cookies[cookieData.name];

    if (!cookieValue) {
      return yield* new NotFoundError({
        message: "No verification request found",
      });
    }

    const state = yield* getCookieVerificationOTPState(
      cookieValue,
      secret
    ).pipe(
      Effect.mapError(
        () =>
          new BadRequestError({
            message: "Invalid verification request",
          })
      )
    );

    return {
      email: state.email,
      type: state.type,
    };
  }).pipe(Effect.provide(VerificationOtpConfig.layer));
}

function deleteVerificationOtp(): Effect.Effect<
  { success: boolean },
  InternalServerError,
  HttpServerRequest.HttpServerRequest
> {
  return Effect.gen(function* () {
    const { appUrl } = yield* VerificationOtpConfig;
    // Mirror the cookie set by postVerificationOtp: same name, path, and
    // Secure flag so the client actually clears it. (Secure is not part of
    // cookie identity, but emitting an identically-Secure Max-Age=0 is the
    // most reliable cross-browser clear.) `removeCookie` would be a no-op
    // here — it only drops a cookie from this response's own collection and
    // never emits a Set-Cookie — leaving the OTP state alive until its
    // 10-minute maxAge elapsed.
    const cookieData = generateVerificationOTPCookieData(
      appUrl.startsWith("https://")
    );

    yield* HttpEffect.appendPreResponseHandler((_request, response) =>
      Effect.succeed(
        response.pipe(
          HttpServerResponse.setCookieUnsafe(cookieData.name, "", {
            ...cookieData.attributes,
            maxAge: Duration.seconds(0),
          })
        )
      )
    );

    return { success: true };
  }).pipe(Effect.provide(VerificationOtpConfig.layer));
}
