import type { Role } from "@feeblo/permissions";
import { isString } from "@feeblo/utils/runtime-kind";
import { parseCookie } from "cookie-es";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as HttpApiMiddleware from "effect/unstable/httpapi/HttpApiMiddleware";
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

/**
 * Requires an authenticated session but, unlike AuthMiddleware, admits
 * SSO-restricted sessions. Use for public-board endpoints whose handlers
 * authorize restricted users via Policy.hasRestrictedOrganizationScope.
 */
export class PublicAuthMiddleware extends RpcMiddleware.Service<
  PublicAuthMiddleware,
  { provides: CurrentSession }
>()("@feeblo/api/PublicAuthMiddleware", {
  error: UnauthorizedError,
}) {}

function getValidatedSessionFromToken(
  auth: AuthHandler,
  token: string,
  // Defaults to the environment-resolved name for the RPC middlewares; the
  // HTTP API middleware passes its composition-local name instead.
  sessionCookie: string = getSessionCookie()
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

export const PublicAuthMiddlewareLive = Layer.effect(
  PublicAuthMiddleware,
  Effect.gen(function* () {
    const auth = yield* Auth;

    return PublicAuthMiddleware.of((effect, options) => {
      const cookieHeader = isString(options.headers?.cookie)
        ? options.headers.cookie
        : options.headers?.Cookie;
      const token = getSessionTokenFromCookieHeader(cookieHeader);

      return getValidatedSessionFromToken(auth, token ?? "").pipe(
        Effect.flatMap((session) =>
          effect.pipe(Effect.provideService(CurrentSession, session))
        )
      );
    });
  })
);

// No `security` declaration here on purpose: `HttpApiBuilder` derives
// credential decoders from the class-level declaration, which is shared by
// every composition, while the session cookie name is resolved per
// composition (see `makeHttpApiAuthMiddlewareLive`). The middleware therefore
// extracts the session cookie itself from the incoming request.
export class HttpApiAuthMiddleware extends HttpApiMiddleware.Service<
  HttpApiAuthMiddleware,
  { provides: CurrentSession }
>()("@feeblo/domain/HttpApiAuthMiddleware", {
  error: UnauthorizedError,
}) {}

/**
 * Builds the HTTP API auth middleware for one server composition.
 *
 * `resolveCookieName` runs once at layer build (the environment is loaded by
 * then) and the resolved name is captured by this composition's middleware
 * instance. No shared declaration is mutated, so compositions using different
 * cookie names each authenticate against their own cookie.
 */
export const makeHttpApiAuthMiddlewareLive = (
  resolveCookieName: () => string
): Layer.Layer<HttpApiAuthMiddleware, never, Auth> =>
  Layer.effect(
    HttpApiAuthMiddleware,
    Effect.gen(function* () {
      const auth = yield* Auth;
      const cookieName = resolveCookieName();

      return HttpApiAuthMiddleware.of((effect) =>
        Effect.flatMap(HttpServerRequest.HttpServerRequest, (request) => {
          const token = request.cookies[cookieName];

          return getValidatedSessionFromToken(
            auth,
            token ?? "",
            cookieName
          ).pipe(
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
          );
        })
      );
    })
  );

export const HttpApiAuthMiddlewareLive =
  makeHttpApiAuthMiddlewareLive(getSessionCookieName);
