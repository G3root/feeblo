import type { Role } from "@feeblo/permissions";
import { isString } from "@feeblo/utils/runtime-kind";
import { parseCookie } from "cookie-es";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as HttpApiMiddleware from "effect/unstable/httpapi/HttpApiMiddleware";
import * as HttpApiSecurity from "effect/unstable/httpapi/HttpApiSecurity";
import * as RpcMiddleware from "effect/unstable/rpc/RpcMiddleware";

import { UnauthorizedError } from "./rpc-errors";
import {
  getSessionCookieName,
  getSessionCookieNameForUrl,
} from "./session-cookie";

// Lazily resolved per-call so tests can stub `process.env` and server
// composition can inject API_URL via `getSessionCookieNameForUrl`.
const getSessionCookie = (): string => getSessionCookieName();

/** Pure helper for server composition that injects the API URL via Config. */
export const getSessionCookieForApiUrl = getSessionCookieNameForUrl;

//TODO: infer session later
export type Session = {
  readonly user: {
    readonly id: string;
    readonly email: string;
    readonly name: string;
    readonly restrictedToOrganizationId?: string | null | undefined;
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
    readonly role: Role;
  }>;
};

export type AuthHandler = {
  readonly handler: (request: Request) => Response | Promise<Response>;
  readonly api: {
    readonly getSession: (args: {
      readonly headers: Headers;
    }) => Promise<Session | null>;
  };
};

export class Auth extends Context.Service<Auth, AuthHandler>()(
  "@feeblo/api/Auth"
) {}

/** @effect-leakable-service */
export class CurrentSession extends Context.Service<CurrentSession, Session>()(
  "@feeblo/domain/CurrentSession"
) {}

export const currentHttpApiSession = Effect.context<never>().pipe(
  Effect.map((context) => Context.getUnsafe(context, CurrentSession))
);

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
    const sessionCookie = getSessionCookie();
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

  const parsedCookie = parseCookie(cookieHeader);

  const value = parsedCookie?.[getSessionCookie()];

  return value;
}

export const AuthMiddlewareLive = Layer.effect(
  AuthMiddleware,
  Effect.gen(function* () {
    const auth = yield* Auth;

    return AuthMiddleware.of((effect, options) => {
      const cookieHeader = isString(options.headers?.cookie)
        ? options.headers.cookie
        : options.headers?.Cookie;
      const token = getSessionTokenFromCookieHeader(cookieHeader);

      return getValidatedSessionFromToken(auth, token ?? "").pipe(
        Effect.flatMap((session) => {
          if (session.user.restrictedToOrganizationId) {
            return Effect.fail(
              new UnauthorizedError({
                message: "SSO sessions cannot access dashboard endpoints",
              })
            );
          }
          return effect.pipe(Effect.provideService(CurrentSession, session));
        })
      );
    });
  })
);

export const OptionalAuthMiddlewareLive = Layer.effect(
  OptionalAuthMiddleware,
  Effect.gen(function* () {
    const auth = yield* Auth;

    return OptionalAuthMiddleware.of((effect, options) => {
      const cookieHeader = isString(options.headers?.cookie)
        ? options.headers.cookie
        : options.headers?.Cookie;
      const token = getSessionTokenFromCookieHeader(cookieHeader);

      return getValidatedSessionFromToken(auth, token ?? "").pipe(
        Effect.map((session) =>
          session.user.restrictedToOrganizationId
            ? Option.none()
            : Option.some(session)
        ),
        Effect.catch(() => Effect.succeed(Option.none())),
        Effect.flatMap((session) =>
          effect.pipe(Effect.provideService(OptionalCurrentSession, session))
        )
      );
    });
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
      // Placeholder only: the real cookie name is resolved from the
      // environment at composition time by `HttpApiAuthMiddlewareLive` (see
      // the patch below). It must NOT be resolved here — `getSessionCookieName()`
      // reads process.env, which may not be populated at module load.
      key: getSessionCookieNameForUrl(undefined),
    }),
  },
}) {}

export const HttpApiAuthMiddlewareLive = Layer.effect(
  HttpApiAuthMiddleware,
  Effect.gen(function* () {
    const auth = yield* Auth;

    // Resolve and patch the session cookie name at composition time (env is
    // loaded by then) instead of at module load. The HttpApi security scheme
    // is consumed lazily by `HttpApiBuilder` when the router is assembled —
    // after this layer has run — so the patch is guaranteed to be in effect
    // before any credential is decoded.
    const cookieName = getSessionCookieName();
    // SAFETY: `ApiKey.key` is typed readonly but is a plain mutable field on a
    // runtime object; patching it here is the intended use of the placeholder.
    (HttpApiAuthMiddleware.security.cookie as { key: string }).key = cookieName;

    return {
      cookie: (effect, { credential }) =>
        getValidatedSessionFromToken(auth, Redacted.value(credential)).pipe(
          Effect.flatMap((session) =>
            Effect.gen(function* () {
              if (session.user.restrictedToOrganizationId) {
                return yield* new UnauthorizedError({
                  message: "SSO sessions cannot access dashboard endpoints",
                });
              }
              return yield* effect.pipe(
                Effect.provideService(CurrentSession, session)
              );
            })
          )
        ),
    };
  })
);
