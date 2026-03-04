import { HttpApiMiddleware, HttpApiSecurity } from "@effect/platform";
import { RpcMiddleware } from "@effect/rpc";
import type { Auth as AuthHandler, Session } from "@feeblo/auth";
import { Context, Effect, Layer, Redacted } from "effect";
import { UnauthorizedError } from "./rpc-errors";

const SESSION_COOKIE_KEY = "better-auth.session_token";

export class Auth extends Context.Tag("@feeblo/api/Auth")<
  Auth,
  AuthHandler
>() {}

export class CurrentSession extends Context.Tag(
  "@feeblo/domain/CurrentSession"
)<CurrentSession, Session>() {}

export class AuthMiddleware extends RpcMiddleware.Tag<AuthMiddleware>()(
  "@feeblo/api/AuthMiddleware",
  {
    provides: CurrentSession,
    failure: UnauthorizedError,
  }
) {}

function getValidatedSessionFromToken(
  auth: AuthHandler,
  token: string
): Effect.Effect<Session, UnauthorizedError> {
  return Effect.gen(function* () {
    if (!token) {
      return yield* Effect.fail(
        new UnauthorizedError({ message: "Not authenticated" })
      );
    }
    const session = yield* Effect.tryPromise({
      try: () =>
        auth.api.getSession({
          headers: new Headers({
            cookie: `${SESSION_COOKIE_KEY}=${token}`,
          }),
        }),
      catch: () => new UnauthorizedError({ message: "Failed to get session" }),
    });
    if (!session) {
      return yield* Effect.fail(
        new UnauthorizedError({ message: "Not authenticated" })
      );
    }
    return session;
  });
}

function getSessionTokenFromCookieHeader(
  cookieHeader: string | undefined
): string | undefined {
  if (!cookieHeader) {
    return undefined;
  }
  const match = cookieHeader.match(
    new RegExp(`(?:^|;\\s*)${SESSION_COOKIE_KEY}=([^;]*)`)
  );
  const value = match?.[1];
  return value ? decodeURIComponent(value.trim()) : undefined;
}

export const AuthMiddlewareLive = Layer.effect(
  AuthMiddleware,
  Effect.gen(function* () {
    const auth = yield* Auth;

    return (options) => {
      const cookieHeader =
        typeof options.headers?.cookie === "string"
          ? options.headers.cookie
          : options.headers?.Cookie;
      const token = getSessionTokenFromCookieHeader(cookieHeader);

      return getValidatedSessionFromToken(auth, token ?? "");
    };
  })
);

export class HttpApiAuthMiddleware extends HttpApiMiddleware.Tag<HttpApiAuthMiddleware>()(
  "@feeblo/domain/HttpApiAuthMiddleware",
  {
    provides: CurrentSession,
    failure: UnauthorizedError,
    security: {
      cookie: HttpApiSecurity.apiKey({
        in: "cookie",
        key: SESSION_COOKIE_KEY,
      }),
    },
  }
) {}

export const HttpApiAuthMiddlewareLive = Layer.effect(
  HttpApiAuthMiddleware,
  Effect.gen(function* () {
    const auth = yield* Auth;
    return {
      cookie: (token: Redacted.Redacted<string>) =>
        getValidatedSessionFromToken(auth, Redacted.value(token)),
    };
  })
);
