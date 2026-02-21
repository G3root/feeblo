import { RpcMiddleware } from "@effect/rpc";
import type { Auth as AuthHandler, Session } from "@feeblo/auth";
import { Context, Effect, Layer } from "effect";
import { UnauthorizedError } from "./rpc-errors";

const SESSION_COOKIE_KEY = "better-auth.session_token";

export class Auth extends Context.Tag("@cronosend/api/Auth")<
  Auth,
  AuthHandler
>() {}

export interface ValidatedSession extends Session {
  session: Session["session"] & {
    activeOrganizationId: string;
    activeMemberId: string;
  };
}

export class CurrentSession extends Context.Tag(
  "@cronosend/domain/CurrentSession"
)<CurrentSession, ValidatedSession>() {}

export class AuthMiddleware extends RpcMiddleware.Tag<AuthMiddleware>()(
  "@cronosend/api/AuthMiddleware",
  {
    provides: CurrentSession,
    failure: UnauthorizedError,
  }
) {}

export const validateSession = (session: Session) =>
  Effect.gen(function* () {
    if (!session.session.activeOrganizationId) {
      return yield* Effect.fail(
        new UnauthorizedError({ message: "Organization not found" })
      );
    }

    if (!session.session.activeMemberId) {
      return yield* Effect.fail(
        new UnauthorizedError({ message: "Member not found" })
      );
    }

    return session as ValidatedSession;
  });

function getValidatedSessionFromToken(
  auth: AuthHandler,
  token: string
): Effect.Effect<ValidatedSession, UnauthorizedError> {
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
    return yield* validateSession(session as Session);
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
