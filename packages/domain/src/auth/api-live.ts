import * as Effect from "effect/Effect";

import * as HttpEffect from "effect/unstable/http/HttpEffect";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";

import * as HttpApiBuilder from "effect/unstable/httpapi/HttpApiBuilder";

import { Api } from "../http/api";
import {
  BadRequestError,
  InternalServerError,
  NotFoundError,
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
        postVerificationOtp(payload)
      )
      .handle("getVerificationOtp", () => getVerificationOtp())
      .handle("deleteVerificationOtp", () => deleteVerificationOtp())
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
  never,
  HttpServerRequest.HttpServerRequest
> {
  return Effect.gen(function* () {
    const cookieData = generateVerificationOTPCookieData(false);

    yield* HttpEffect.appendPreResponseHandler((_request, response) =>
      Effect.succeed(
        response.pipe(HttpServerResponse.removeCookie(cookieData.name))
      )
    );

    return { success: true };
  });
}
