import { parseCookies } from "better-auth";
import { Context, Effect, Layer, Option, Redacted } from "effect";
import { HttpApiMiddleware, HttpApiSecurity } from "effect/unstable/httpapi";
import { RpcMiddleware } from "effect/unstable/rpc";
import { UnauthorizedError } from "./rpc-errors";
import { getSessionCookieName } from "./session-cookie";

const sessionCookie = getSessionCookieName();

//TODO: infer session later
export type Session = {
  readonly user: {
    readonly id: string;
    readonly email: string;
    readonly name: string;
  };
  readonly session: {
    readonly userId: string;
    readonly token: string;
  };
  readonly organizations: ReadonlyArray<{
    readonly id: string;
  }>;
  readonly memberships: ReadonlyArray<{
    readonly membershipId: string;
    readonly organizationId: string;
    readonly role: "owner" | "admin" | "member";
  }>;
};

export type AuthHandler = {
  readonly handler: (request: Request) => Response | Promise<Response>;
  readonly api: {
    readonly getSession: (args: {
      readonly headers: Headers;
    }) => Promise<Session | null>;
    readonly createInvitation: (args: {
      readonly headers: Headers;
      readonly body: {
        readonly organizationId: string;
        readonly email: string;
        readonly role: "owner" | "admin" | "member";
      };
    }) => Promise<unknown>;
  };
};

export class Auth extends Context.Service<Auth, AuthHandler>()(
  "@feeblo/api/Auth"
) {}

/** @effect-leakable-service */
export class CurrentSession extends Context.Service<CurrentSession, Session>()(
  "@feeblo/domain/CurrentSession"
) {}

/** Session when authenticated; None when unauthenticated. Use for optional-auth routes (e.g. PostListPublic). */
export class OptionalCurrentSession extends Context.Service<
  OptionalCurrentSession,
  Option.Option<Session>
>()("@feeblo/domain/OptionalCurrentSession") {}

export class AuthMiddleware extends RpcMiddleware.Service<
  AuthMiddleware,
  { provides: CurrentSession }
>()("@feeblo/api/AuthMiddleware", {
  error: UnauthorizedError,
}) {}

/** Resolves session when possible; never fails. Provides Option.none() when not authenticated. */
export class OptionalAuthMiddleware extends RpcMiddleware.Service<
  OptionalAuthMiddleware,
  { provides: OptionalCurrentSession }
>()("@feeblo/api/OptionalAuthMiddleware", {
  error: UnauthorizedError,
}) {}

function getValidatedSessionFromToken(
  auth: AuthHandler,
  token: string
): Effect.Effect<Session, UnauthorizedError> {
  return Effect.gen(function* () {
    if (!token) {
      return yield* new UnauthorizedError({ message: "Not authenticated" });
    }
    const session = yield* Effect.tryPromise({
      try: () =>
        auth.api.getSession({
          headers: new Headers({
            cookie: `${sessionCookie}=${token}`,
          }),
        }),
      catch: () => new UnauthorizedError({ message: "Failed to get session" }),
    });
    if (!session) {
      return yield* new UnauthorizedError({ message: "Not authenticated" });
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

  const parsedCookie = parseCookies(cookieHeader);
  const token = parsedCookie.get(sessionCookie);

  return token;
}

export const AuthMiddlewareLive = Layer.effect(
  AuthMiddleware,
  Effect.gen(function* () {
    const auth = yield* Auth;

    return (effect, options) => {
      const cookieHeader =
        typeof options.headers?.cookie === "string"
          ? options.headers.cookie
          : options.headers?.Cookie;
      const token = getSessionTokenFromCookieHeader(cookieHeader);

      return getValidatedSessionFromToken(auth, token ?? "").pipe(
        Effect.flatMap((session) =>
          effect.pipe(Effect.provideService(CurrentSession, session))
        )
      );
    };
  })
);

export const OptionalAuthMiddlewareLive = Layer.effect(
  OptionalAuthMiddleware,
  Effect.gen(function* () {
    const auth = yield* Auth;

    return (effect, options) => {
      const cookieHeader =
        typeof options.headers?.cookie === "string"
          ? options.headers.cookie
          : options.headers?.Cookie;
      const token = getSessionTokenFromCookieHeader(cookieHeader);

      return getValidatedSessionFromToken(auth, token ?? "").pipe(
        Effect.map(Option.some),
        Effect.catch(() => Effect.succeed(Option.none())),
        Effect.flatMap((session) =>
          effect.pipe(Effect.provideService(OptionalCurrentSession, session))
        )
      );
    };
  })
);

export class HttpApiAuthMiddleware extends HttpApiMiddleware.Service<
  HttpApiAuthMiddleware,
  { provides: CurrentSession }
>()("@feeblo/domain/HttpApiAuthMiddleware", {
  error: UnauthorizedError,
  security: {
    cookie: HttpApiSecurity.apiKey({
      in: "cookie",
      key: sessionCookie,
    }),
  },
}) {}

export const HttpApiAuthMiddlewareLive = Layer.effect(
  HttpApiAuthMiddleware,
  Effect.gen(function* () {
    const auth = yield* Auth;
    return {
      cookie: (effect, { credential }) =>
        getValidatedSessionFromToken(auth, Redacted.value(credential)).pipe(
          Effect.flatMap((session) =>
            effect.pipe(Effect.provideService(CurrentSession, session))
          )
        ),
    };
  })
);
