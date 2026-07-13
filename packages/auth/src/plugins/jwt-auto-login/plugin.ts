/** biome-ignore-all lint/style/noNonNullAssertion: <explanation> */
/** biome-ignore-all lint/suspicious/noNonNullAssertedOptionalChain: <explanation> */
import type {
  BetterAuthPlugin,
  GenericEndpointContext,
  Session,
} from "better-auth";
import {
  APIError,
  addOAuthServerContext,
  createAuthEndpoint,
  createAuthMiddleware,
  getOAuthState,
  getSessionFromCtx,
} from "better-auth/api";
import { parseSetCookieHeader, setSessionCookie } from "better-auth/cookies";
import { parseUserOutput } from "better-auth/db";
import * as z from "zod";
import { JWT_AUTO_LOGIN_ERROR_CODES } from "./error-codes";
import { schema } from "./schema";
import type {
  JwtAutoLoginOptions,
  JwtAutoLoginSession,
  SsoUserError,
  UserWithJwtAutoLogin,
} from "./types";

const SSO_ERROR_STATUS: Record<
  SsoUserError["code"],
  "UNAUTHORIZED" | "BAD_REQUEST" | "INTERNAL_SERVER_ERROR"
> = {
  ORGANIZATION_HAS_NO_JWT_SECRET: "UNAUTHORIZED",
  INVALID_JWT: "UNAUTHORIZED",
  SSO_TOKEN_MISSING_EMAIL_OR_NAME: "BAD_REQUEST",
  FAILED_TO_CREATE_SSO_USER: "INTERNAL_SERVER_ERROR",
  FAILED_TO_CREATE_SSO_CONTACT: "INTERNAL_SERVER_ERROR",
};

export const ID = "jwt-auto-login" as const;
export const SIGN_IN_PATH = `/sign-in/${ID}` as const;

async function resolveAnonymousSession(ctx: GenericEndpointContext): Promise<{
  // biome-ignore lint/suspicious/noExplicitAny: <explanation>
  session: Session & Record<string, any>;
  // biome-ignore lint/suspicious/noExplicitAny: <explanation>
  user: UserWithJwtAutoLogin & Record<string, any>;
} | null> {
  const cookieSession = await getSessionFromCtx<{
    restrictedToOrganizationId: string | null;
  }>(ctx, { disableRefresh: true });
  if (cookieSession?.user.restrictedToOrganizationId) {
    return {
      session: cookieSession.session,
      user: {
        ...cookieSession.user,
        restrictedToOrganizationId:
          cookieSession.user.restrictedToOrganizationId,
      },
    };
  }

  const autoLoginUserId = (await getOAuthState())?.serverContext
    ?.autoLoginUserId;
  if (typeof autoLoginUserId !== "string") {
    return null;
  }
  const user = (await ctx.context.internalAdapter.findUserById(
    autoLoginUserId
  )) as JwtAutoLoginSession["user"];
  if (!user?.restrictedToOrganizationId) {
    return null;
  }
  const [anonymousSession] = await ctx.context.internalAdapter.listSessions(
    user.id,
    { onlyActiveSessions: true }
  );
  if (!anonymousSession) {
    return null;
  }
  return {
    session: anonymousSession,
    user: {
      ...user,
      restrictedToOrganizationId: user.restrictedToOrganizationId,
    },
  };
}

export const jwtAutoLogin = (options: JwtAutoLoginOptions) => {
  return {
    id: ID,
    endpoints: {
      signInAutoLogin: createAuthEndpoint(
        SIGN_IN_PATH,
        {
          method: "POST",
          body: z.object({
            organizationId: z.string(),
            token: z.string(),
          }),
          metadata: {
            openapi: {
              description:
                "Verify an organization JWT and create a restricted widget-portal session (SSO auto-login).",
              responses: {
                200: {
                  description: "SSO session created",
                  content: {
                    "application/json": {
                      schema: {
                        type: "object",
                        properties: {
                          user: {
                            $ref: "#/components/schemas/User",
                          },
                          session: {
                            $ref: "#/components/schemas/Session",
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        async (ctx) => {
          // If the current request already has a valid restricted (anonymous)
          // widget session, reject any further attempts to create another one.
          // This prevents a widget user from signing in anonymously again while
          // they are already authenticated.
          const existingSession = await getSessionFromCtx<{
            restrictedToOrganizationId: string | null;
          }>(ctx, { disableRefresh: true });

          if (existingSession?.user.restrictedToOrganizationId) {
            throw APIError.from(
              "BAD_REQUEST",
              JWT_AUTO_LOGIN_ERROR_CODES.ANONYMOUS_USERS_CANNOT_SIGN_IN_AGAIN_ANONYMOUSLY
            );
          }

          // Verify the organization JWT, upsert the restricted widget user and
          // linked contact. The Effect-based implementation lives in the domain
          // package and is injected via `options.createSsoUser` so this plugin
          // stays better-auth-only.
          const result = await options.createSsoUser({
            organizationId: ctx.body.organizationId,
            token: ctx.body.token,
          });

          if ("code" in result) {
            throw APIError.from(
              SSO_ERROR_STATUS[result.code],
              JWT_AUTO_LOGIN_ERROR_CODES[result.code]
            );
          }

          const user = await ctx.context.internalAdapter.findUserById(
            result.userId
          );
          if (!user) {
            throw APIError.from(
              "INTERNAL_SERVER_ERROR",
              JWT_AUTO_LOGIN_ERROR_CODES.FAILED_TO_CREATE_SSO_USER
            );
          }

          const session = await ctx.context.internalAdapter.createSession(
            user.id
          );

          if (!session) {
            throw APIError.from(
              "BAD_REQUEST",
              JWT_AUTO_LOGIN_ERROR_CODES.COULD_NOT_CREATE_SESSION
            );
          }

          await setSessionCookie(ctx, {
            session,
            user,
          });
          return ctx.json({
            token: session.token,
            user: parseUserOutput(ctx.context.options, user),
          });
        }
      ),
    },

    hooks: {
      before: [
        {
          matcher(ctx) {
            // Generic OAuth providers also sign in through `/sign-in/social`,
            // so this single path covers them too.
            return ctx.path === "/sign-in/social";
          },
          handler: createAuthMiddleware(async (ctx) => {
            const session = await getSessionFromCtx<{
              restrictedToOrganizationId: string | null;
            }>(ctx, { disableRefresh: true });
            if (!session?.user.restrictedToOrganizationId) {
              return;
            }
            // Carry the anonymous user id across the provider redirect so the
            // callback can link the account even when the session cookie is
            // absent (for example Expo's in-app browser).
            await addOAuthServerContext({
              autoLoginUserId: session.user.id,
            });
          }),
        },
      ],
      after: [
        {
          matcher(ctx) {
            return (
              // biome-ignore lint/complexity/useSimplifiedLogicExpression: <explanation>
              ctx.path?.startsWith("/sign-in") ||
              ctx.path?.startsWith("/sign-up") ||
              ctx.path?.startsWith("/callback") ||
              ctx.path?.startsWith("/magic-link/verify") ||
              ctx.path?.startsWith("/email-otp/verify-email") ||
              ctx.path?.startsWith("/one-tap/callback") ||
              ctx.path?.startsWith("/passkey/verify-authentication") ||
              ctx.path?.startsWith("/phone-number/verify") ||
              ctx.path?.startsWith("/verify-email") ||
              false
            );
          },
          handler: createAuthMiddleware(async (ctx) => {
            const setCookie = ctx.context.responseHeaders?.get("set-cookie");

            /**
             * We can consider the user is about to sign in or sign up
             * if the response contains a session token.
             */
            const sessionTokenName = ctx.context.authCookies.sessionToken.name;
            /**
             * The user is about to link their account.
             */

            const sessionCookie = parseSetCookieHeader(setCookie || "")
              .get(sessionTokenName)
              ?.value.split(".")[0]!;

            if (!sessionCookie) {
              return;
            }
            /**
             * Make sure the user had an anonymous session. Falls back to the
             * server-only OAuth state when the callback arrives without the
             * anonymous session cookie (for example Expo).
             */
            const session = await resolveAnonymousSession(ctx);
            if (!session) {
              return;
            }

            if (ctx.path === SIGN_IN_PATH && !ctx.context.newSession) {
              throw APIError.from(
                "BAD_REQUEST",
                JWT_AUTO_LOGIN_ERROR_CODES.ANONYMOUS_USERS_CANNOT_SIGN_IN_AGAIN_ANONYMOUSLY
              );
            }
            const newSession = ctx.context.newSession;
            if (!newSession) {
              return;
            }

            // The user is linking their previous anonymous (restricted widget)
            // account with a real credential (email / password / social) from
            // the global app. Give the integrator a chance to transfer data
            // (contacts, posts) from the anonymous user to the new user before
            // the anonymous user is cleaned up below.
            const newSessionUser = newSession.user as
              // biome-ignore lint/suspicious/noExplicitAny: <explanation>
              (UserWithJwtAutoLogin & Record<string, any>) | undefined;
            const isSameUser = newSessionUser?.id === session.user.id;
            const newSessionIsAnonymous =
              !!newSessionUser?.restrictedToOrganizationId;
            if (isSameUser || newSessionIsAnonymous) {
              return;
            }

            if (options?.onLinkAccount) {
              try {
                await options.onLinkAccount({
                  anonymousUser: {
                    session: session.session,
                    user: session.user,
                  },
                  newUser: newSession,
                  ctx,
                });
              } catch (error) {
                // Skip cleanup so the anonymous user's data is preserved for a
                // later retry instead of being orphaned by the cascade below.
                ctx.context.logger.error(
                  "Failed to link anonymous user data to the new user; skipping cleanup",
                  {
                    anonymousUserId: session.user.id,
                    newUserId: newSessionUser?.id,
                    error,
                  }
                );
                return;
              }
            }

            try {
              await ctx.context.internalAdapter.deleteUserSessions(
                session.user.id
              );
              await ctx.context.internalAdapter.deleteUser(session.user.id);
            } catch (error) {
              // TODO: collapse session+user cleanup into `internalAdapter.deleteUser`
              // to remove the partial-state window where sessions are deleted but
              // the user row remains.
              ctx.context.logger.error(
                "Failed to clean up anonymous user during post-link cleanup",
                { anonymousUserId: session.user.id, error }
              );
            }
          }),
        },
      ],
    },
    schema,
    $ERROR_CODES: JWT_AUTO_LOGIN_ERROR_CODES,
  } satisfies BetterAuthPlugin;
};
