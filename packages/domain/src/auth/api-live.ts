import {
  HttpApiBuilder,
  HttpApp,
  HttpServerRequest,
  HttpServerResponse,
} from "@effect/platform";
import { Config, Effect, Either } from "effect";
import { Api } from "../http/api";
import {
  BadRequestError,
  InternalServerError,
  NotFoundError,
} from "../rpc-errors";
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
): Effect.Effect<{ success: boolean }, BadRequestError | InternalServerError> {
  return Effect.gen(function* () {
    const appUrl = yield* Config.string("VITE_APP_URL").pipe(
      Effect.mapError(
        () => new InternalServerError({ message: "Missing VITE_APP_URL" })
      )
    );
    const secret = yield* Config.string("AUTH_ENCRYPTION_KEY").pipe(
      Effect.mapError(
        () =>
          new InternalServerError({ message: "Missing AUTH_ENCRYPTION_KEY" })
      )
    );

    const email = payload.email.toLowerCase();
    if (!isValidVerificationOTPEmail(email)) {
      return yield* Effect.fail(
        new BadRequestError({ message: "Invalid verification state" })
      );
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

    yield* HttpApp.appendPreResponseHandler((_request, response) =>
      Effect.succeed(
        response.pipe(
          HttpServerResponse.unsafeSetCookie(
            cookieData.name,
            encryptedState,
            cookieData.attributes
          )
        )
      )
    );

    return { success: true };
  });
}

function getVerificationOtp(): Effect.Effect<
  { email: string; type: "email-verification" | "reset-password" },
  BadRequestError | NotFoundError | InternalServerError,
  HttpServerRequest.HttpServerRequest
> {
  return Effect.gen(function* () {
    const secret = yield* Config.string("AUTH_ENCRYPTION_KEY").pipe(
      Effect.mapError(
        () =>
          new InternalServerError({ message: "Missing AUTH_ENCRYPTION_KEY" })
      )
    );
    const request = yield* HttpServerRequest.HttpServerRequest;
    const cookieData = generateVerificationOTPCookieData(false);
    const cookieValue = request.cookies[cookieData.name];

    if (!cookieValue) {
      return yield* Effect.fail(
        new NotFoundError({ message: "No verification request found" })
      );
    }

    const stateResult = yield* getCookieVerificationOTPState(
      cookieValue,
      secret
    ).pipe(Effect.either);

    if (Either.isLeft(stateResult)) {
      return yield* Effect.fail(
        new BadRequestError({ message: "Invalid verification request" })
      );
    }

    return {
      email: stateResult.right.email,
      type: stateResult.right.type,
    };
  });
}

function deleteVerificationOtp(): Effect.Effect<{ success: boolean }> {
  return Effect.gen(function* () {
    const cookieData = generateVerificationOTPCookieData(false);

    yield* HttpApp.appendPreResponseHandler((_request, response) =>
      Effect.succeed(
        response.pipe(HttpServerResponse.removeCookie(cookieData.name))
      )
    );

    return { success: true };
  });
}
