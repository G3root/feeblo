import { isString } from "@feeblo/utils/runtime-kind";
import { NodeCrypto } from "@effect/platform-node";
import { Database } from "@feeblo/db";
import * as schema from "@feeblo/db/schema";
import { BillingRepository } from "@feeblo/domain/billing/repository";
import { PolarService } from "@feeblo/domain/billing/service";
import { EntitlementPolicy } from "@feeblo/domain/entitlement/policies";
import { MembershipPolicy } from "@feeblo/domain/membership/policies";
import { MembershipRepository } from "@feeblo/domain/membership/repository";
import { PolicyDeniedError } from "@feeblo/domain/policy";
import { RateLimitService } from "@feeblo/domain/rate-limit/service";
import { WelcomeUserWorkflow } from "@feeblo/domain/user/workflows";
import {
  createSsoSession,
  linkAnonymousAccount,
  SsoError,
  SsoRepositoriesLive,
} from "@feeblo/domain/widget/sso";
import { WorkspaceRepository } from "@feeblo/domain/workspace/repository";
import type { Role } from "@feeblo/permissions";
import { Mailer } from "@feeblo/transactional/mailer";
import { polar, webhooks } from "@polar-sh/better-auth";
import {
  type BetterAuthOptions,
  type BetterAuthPlugin,
  betterAuth,
} from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import {
  admin,
  captcha,
  customSession,
  emailOTP,
  lastLoginMethod,
  organization,
  testUtils,
} from "better-auth/plugins";
import {
  type GenericOAuthUserInfo,
  genericOAuth,
} from "better-auth/plugins/generic-oauth";
import { eq } from "drizzle-orm";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import { WorkflowEngine } from "effect/unstable/workflow/WorkflowEngine";

import { drizzleAdapter } from "./adapter/drizzzle-adapter";
import { clientTimeZoneHeader, isValidTimeZone } from "./client-time-zone";
import { AuthConfig } from "./config";
import {
  ORGANIZATION_ROLES,
  organizationAccessControl,
} from "./organization-roles";
import { jwtAutoLogin } from "./plugins/jwt-auto-login/plugin";
import type { JwtAutoLoginOptions } from "./plugins/jwt-auto-login/types";
import { AUTH_SESSION_DURATION_SECONDS } from "./session";
import { getTrustedOrigins, isEmailBlocked, isTemporaryEmail } from "./utils";

const loadPasswordResetEmail = () =>
  import("@feeblo/transactional/templates/password-reset");

const loadOrganizationInvitationEmail = () =>
  import("@feeblo/transactional/templates/organization-invitation");

const loadVerificationOtpEmail = () =>
  import("@feeblo/transactional/templates/verification-otp");

const createTestUtilsPlugin = (): BetterAuthPlugin =>
  // SAFETY: better-auth's testUtils plugin implements the BetterAuthPlugin
  // contract; the cast bridges its generically-typed result.
  testUtils({ captureOTP: true }) as BetterAuthPlugin;

export const initAuthHandler = (
  makeMailerLayer: () => Layer.Layer<
    Mailer,
    Layer.Error<typeof Mailer.layer>
  > = () => Mailer.layer,
  rateLimitLayer: Layer.Layer<RateLimitService> = RateLimitService.layerMemory
) =>
  Effect.gen(function* () {
    const {
      appUrl,
      apiUrl,
      githubClientId,
      githubClientSecret,
      googleClientId,
      googleClientSecret,
      githubEmulatorUrl,
      googleEmulatorUrl,
      secret,
      signUpEnabled,
      turnstileKey,
      allowedEmails,
      nodeEnv,
      appRootDomain,
      emailVerificationRequired,
      autoSignInAfterSignUp,
    } = yield* AuthConfig;
    const polarService = yield* PolarService;

    const isTest = nodeEnv === "test";

    const trustedOrigins = yield* getTrustedOrigins;
    const db = yield* Database.Database;
    const workflowEngine = yield* WorkflowEngine;

    const dbLayer = Layer.succeed(Database.Database, db);
    const entitlementPolicyLayer = EntitlementPolicy.layer.pipe(
      Layer.provide(WorkspaceRepository.layer)
    );
    const membershipPolicyLayer = MembershipPolicy.layer.pipe(
      Layer.provide(entitlementPolicyLayer),
      Layer.provide(MembershipRepository.layer)
    );

    const callbackRuntime = ManagedRuntime.make(
      Layer.mergeAll(
        PolarService.layer,
        BillingRepository.layer,
        entitlementPolicyLayer,
        membershipPolicyLayer,
        MembershipRepository.layer,
        makeMailerLayer(),
        WorkspaceRepository.layer,
        Layer.succeed(RateLimitService, yield* RateLimitService),
        SsoRepositoriesLive,
        NodeCrypto.layer
      ).pipe(Layer.provideMerge(dbLayer))
    );

    const scheduleWelcome = (user: {
      readonly email: string;
      readonly id: string;
      readonly name: string;
    }) =>
      callbackRuntime.runPromise(
        WelcomeUserWorkflow.execute(
          {
            userId: user.id,
            email: user.email,
            name: user.name,
            dashboardUrl: appUrl,
          },
          { discard: true }
        ).pipe(
          Effect.provideService(WorkflowEngine, workflowEngine),
          Effect.catchCause((cause) =>
            Effect.logWarning("Failed to queue welcome email", cause).pipe(
              Effect.annotateLogs({ userId: user.id })
            )
          )
        )
      );

    const updateTimeZone = (
      userId: string,
      timeZone: string | null | undefined
    ) => {
      if (!(timeZone && isValidTimeZone(timeZone))) {
        return Promise.resolve();
      }
      return callbackRuntime.runPromise(
        Effect.gen(function* () {
          const now = yield* DateTime.nowAsDate;
          yield* db
            .update(schema.userTable)
            .set({ timezone: timeZone, updatedAt: now })
            .where(eq(schema.userTable.id, userId));
        }).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("Failed to update user timezone", cause).pipe(
              Effect.annotateLogs({ userId, timeZone })
            )
          )
        )
      );
    };

    const ssoOptions: JwtAutoLoginOptions = {
      createSsoUser: async ({ clientIp, organizationId, token }) => {
        try {
          return await callbackRuntime.runPromise(
            createSsoSession({ clientIp, organizationId, token })
          );
        } catch (error) {
          if (error instanceof SsoError) {
            return { code: error.code, message: error.message };
          }
          return { code: "FAILED_TO_CREATE_SSO_USER" };
        }
      },
      async onLinkAccount({ anonymousUser, newUser }) {
        await callbackRuntime.runPromise(
          linkAnonymousAccount({
            anonymousUserId: anonymousUser.user.id,
            newUserId: newUser.user.id,
          })
        );
      },
    };

    const mapPolicyDeniedToApiError = <T,>(error: T) => {
      if (error instanceof PolicyDeniedError) {
        return new APIError("FORBIDDEN", {
          message: error.reason ?? "Forbidden",
        });
      }

      return error;
    };

    const runCallbackPolicy = async (
      effect: Parameters<typeof callbackRuntime.runPromise>[0]
    ) => {
      try {
        await callbackRuntime.runPromise(effect);
      } catch (error) {
        throw mapPolicyDeniedToApiError(error);
      }
    };

    /**
     * Best-effort cancellation of a deleted tenant's Polar subscription. Runs
     * before the organization row (and its cascaded subscription rows) are
     * deleted so the external subscription id is still queryable; a failure to
     * reach Polar must never block the deletion.
     */
    const cancelOrganizationSubscription = async (organizationId: string) => {
      await callbackRuntime.runPromise(
        BillingRepository.use((billingRepository) =>
          billingRepository.findSubscriptionByOrganizationId({
            organizationId,
          })
        ).pipe(
          Effect.flatMap((subscription) =>
            Option.match(subscription, {
              onNone: () => Effect.void,
              onSome: (sub) =>
                PolarService.use((polarService) =>
                  polarService.revokeSubscription({ id: sub.externalId })
                ),
            })
          ),
          Effect.catchCause((cause) =>
            Effect.logWarning(
              "Failed to cancel billing for deleted organization",
              cause
            ).pipe(Effect.annotateLogs({ organizationId }))
          )
        )
      );
    };

    // Local OAuth emulator (vercel-labs/emulate) support.
    //
    // better-auth's built-in GitHub/Google providers hardcode the token and
    // userinfo endpoints to the real providers, so the emulator is wired up
    // through the genericOAuth plugin instead, which supports per-provider
    // authorizationUrl / tokenUrl / userInfoUrl overrides. The emulators serve
    // the same paths as the real providers:
    //   github: /login/oauth/authorize, /login/oauth/access_token, /user
    //   google: /o/oauth2/v2/auth, /oauth2/token, /oauth2/v2/userinfo (+ OIDC discovery)
    //
    // Env contract (values must match emulate.config.yaml):
    //   GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET + GITHUB_EMULATOR_URL
    //   GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET + GOOGLE_EMULATOR_URL
    //
    // Providers managed by the emulator are excluded from the built-in
    // socialProviders block below so their IDs are not registered twice.
    // Emulator GitHub profiles are api.github.com shaped (login/avatar_url),
    // which the generic provider doesn't map by itself.
    type GitHubEmulatorProfile = GenericOAuthUserInfo & {
      readonly login?: string;
      readonly avatar_url?: string;
    };

    const githubEmulator =
      Option.isSome(githubEmulatorUrl) &&
      Option.isSome(githubClientId) &&
      Option.isSome(githubClientSecret)
        ? {
            providerId: "github" as const,
            name: "GitHub",
            clientId: githubClientId.value,
            clientSecret: githubClientSecret.value,
            authorizationUrl: `${githubEmulatorUrl.value}/login/oauth/authorize`,
            tokenUrl: `${githubEmulatorUrl.value}/login/oauth/access_token`,
            userInfoUrl: `${githubEmulatorUrl.value}/user`,
            scopes: ["read:user", "user:email"],
            // The emulator rejects basic-auth client credentials; secrets go
            // in the request body.
            tokenEndpointAuth: { method: "client_secret_post" } as const,
            disableSignUp: !signUpEnabled,
            disableImplicitSignUp: !signUpEnabled,
            mapProfileToUser: (profile: GitHubEmulatorProfile) => {
              const name = profile.name ?? profile.login;
              return {
                name: name ?? "",
                ...(profile.avatar_url && { image: profile.avatar_url }),
                // The emulator always issues emails for verified users.
                emailVerified: profile.emailVerified ?? Boolean(profile.email),
              };
            },
          }
        : null;

    const googleEmulator =
      Option.isSome(googleEmulatorUrl) &&
      Option.isSome(googleClientId) &&
      Option.isSome(googleClientSecret)
        ? {
            providerId: "google" as const,
            name: "Google",
            clientId: googleClientId.value,
            clientSecret: googleClientSecret.value,
            // The emulate Google server signs id_tokens with HS256 and serves
            // an empty JWKS, so OIDC discovery (which enables mandatory id_token
            // verification against the discovered JWKS) cannot work here. Use
            // explicit endpoints instead so better-auth skips id_token
            // verification and resolves the user from the userinfo endpoint.
            authorizationUrl: `${googleEmulatorUrl.value}/o/oauth2/v2/auth`,
            tokenUrl: `${googleEmulatorUrl.value}/oauth2/token`,
            userInfoUrl: `${googleEmulatorUrl.value}/oauth2/v2/userinfo`,
            scopes: ["openid", "email", "profile"],
            prompt: "select_account" as const,
            tokenEndpointAuth: { method: "client_secret_post" } as const,
            disableSignUp: !signUpEnabled,
            disableImplicitSignUp: !signUpEnabled,
          }
        : null;

    const emulatorProviders = [githubEmulator, googleEmulator].filter(
      (provider): provider is NonNullable<typeof provider> => provider !== null
    );

    const baseConfig = {
      plugins: [jwtAutoLogin(ssoOptions)],
    } satisfies BetterAuthOptions;

    type VerificationOtpFlow =
      | "email-verification"
      | "password-reset"
      | "sign-in";
    const verificationOtpRateLimitedPaths = new Set([
      "/email-otp/request-password-reset",
      "/forget-password/email-otp",
      "/email-otp/request-email-change",
      "/email-otp/send-verification-otp",
    ]);

    const consumeVerificationOtpRateLimitForFlow = async (
      flow: VerificationOtpFlow,
      email: string
    ) => {
      await callbackRuntime.runPromise(
        RateLimitService.use((rateLimiter) =>
          flow === "password-reset"
            ? rateLimiter.consumePasswordResetOtp(email)
            : flow === "sign-in"
              ? rateLimiter.consumeSignInOtp(email)
              : rateLimiter.consumeEmailVerificationOtp(email)
        ).pipe(
          Effect.catchTag("RateLimiterError", (error) =>
            Effect.fail(
              new APIError(
                error.reason._tag === "RateLimitExceeded"
                  ? "TOO_MANY_REQUESTS"
                  : "INTERNAL_SERVER_ERROR",
                {
                  code:
                    error.reason._tag === "RateLimitExceeded"
                      ? "VERIFICATION_OTP_RATE_LIMITED"
                      : "VERIFICATION_OTP_RATE_LIMIT_UNAVAILABLE",
                  message:
                    error.reason._tag === "RateLimitExceeded"
                      ? "Too many verification codes requested. Please try again later."
                      : "Unable to send a verification code. Please try again.",
                  ...(error.reason._tag === "RateLimitExceeded" && {
                    retryAfterSeconds: Math.ceil(
                      Duration.toSeconds(error.reason.retryAfter)
                    ),
                  }),
                },
                error.reason._tag === "RateLimitExceeded"
                  ? {
                      "Retry-After": String(
                        Math.ceil(Duration.toSeconds(error.reason.retryAfter))
                      ),
                    }
                  : undefined
              )
            )
          )
        )
      );
    };

    const consumeVerificationOtpRateLimit = async (ctx: {
      path: string;
      body?: Record<string, string | number | boolean | null | undefined>;
    }) => {
      const flow =
        ctx.path === "/email-otp/request-password-reset" ||
        ctx.path === "/forget-password/email-otp"
          ? ("password-reset" as const)
          : ctx.path === "/email-otp/request-email-change"
            ? ("email-verification" as const)
            : ctx.path === "/email-otp/send-verification-otp"
              ? ctx.body?.type === "sign-in"
                ? ("sign-in" as const)
                : ctx.body?.type === "forget-password"
                  ? ("password-reset" as const)
                  : ("email-verification" as const)
              : null;

      if (!flow) {
        return;
      }

      const email =
        ctx.path === "/email-otp/request-email-change"
          ? ctx.body?.newEmail
          : ctx.body?.email;

      if (!isString(email) || !email) {
        return;
      }

      await consumeVerificationOtpRateLimitForFlow(flow, email);
    };

    const config = {
      ...baseConfig,
      database: drizzleAdapter(db, {
        provider: "pg",
        schema: {
          user: schema.userTable,
          session: schema.sessionTable,
          account: schema.accountTable,
          verification: schema.verificationTable,
          organization: schema.organizationTable,
          member: schema.memberTable,
          invitation: schema.invitationTable,
          twoFactor: schema.twoFactorTable,
        },
      }),

      baseURL: apiUrl,
      secret: Redacted.value(secret),
      session: {
        expiresIn: AUTH_SESSION_DURATION_SECONDS,
      },
      ...((Option.isSome(githubClientId) &&
        Option.isSome(githubClientSecret) &&
        Option.isNone(githubEmulatorUrl)) ||
      (Option.isSome(googleClientId) &&
        Option.isSome(googleClientSecret) &&
        Option.isNone(googleEmulatorUrl))
        ? {
            socialProviders: {
              ...(Option.isSome(githubClientId) &&
                Option.isSome(githubClientSecret) &&
                Option.isNone(githubEmulatorUrl) && {
                  github: {
                    clientId: githubClientId.value,
                    clientSecret: githubClientSecret.value,
                    disableSignUp: !signUpEnabled,
                    disableImplicitSignUp: !signUpEnabled,
                  },
                }),
              ...(Option.isSome(googleClientId) &&
                Option.isSome(googleClientSecret) &&
                Option.isNone(googleEmulatorUrl) && {
                  google: {
                    prompt: "select_account",
                    clientId: googleClientId.value,
                    clientSecret: googleClientSecret.value,
                    disableSignUp: !signUpEnabled,
                    disableImplicitSignUp: !signUpEnabled,
                  },
                }),
            },
          }
        : undefined),
      telemetry: {
        enabled: false,
      },
      trustedOrigins,

      advanced: {
        crossSubDomainCookies: {
          // Production-only: a shared Domain cookie across *.localhost is
          // impossible because Chromium treats localhost as an effective TLD
          // and rejects Domain=localhost cookies set from subdomains. In dev,
          // the same-origin proxy (astro.config.mjs) instead sets host-only
          // cookies first-party per host, which privacy browsers accept.
          enabled: nodeEnv === "production",
          domain: appRootDomain.split(":")[0] ?? appRootDomain,
        },
        defaultCookieAttributes: {
          secure: true,
          httpOnly: true,
          sameSite: "none", // Allows CORS-based cookie sharing across subdomains
        },
      },
      emailVerification: {
        autoSignInAfterVerification: true,
        afterEmailVerification: async (user) => {
          await scheduleWelcome(user);
        },
      },
      emailAndPassword: {
        enabled: signUpEnabled,
        disableSignUp: !signUpEnabled,
        requireEmailVerification: emailVerificationRequired,
        autoSignIn: autoSignInAfterSignUp,

        async sendResetPassword(data) {
          const { createPasswordResetEmail } = await loadPasswordResetEmail();
          await callbackRuntime.runPromise(
            Mailer.use((mailer) =>
              mailer.send({
                to: data.user.email,
                ...createPasswordResetEmail({
                  resetUrl: data.url,
                  recipientName: data.user.name,
                }),
              })
            )
          );
        },
      },
      plugins: [
        ...baseConfig.plugins,
        ...(emulatorProviders.length > 0
          ? [genericOAuth({ config: emulatorProviders })]
          : []),
        ...(polarService.client && Option.isSome(polarService.webhookSecret)
          ? [
              polar({
                client: polarService.client,
                createCustomerOnSignUp: true,

                use: [
                  webhooks({
                    secret: polarService.webhookSecret.value.pipe(
                      Redacted.value
                    ),

                    onPayload: async (payload) => {
                      switch (payload.type) {
                        case "product.created":
                        case "product.updated": {
                          await callbackRuntime
                            .runPromise(
                              BillingRepository.use((billingRepository) =>
                                billingRepository.upsertProduct(payload.data)
                              )
                            )
                            .then(() => undefined);
                          break;
                        }

                        case "subscription.updated":
                        case "subscription.canceled":
                        case "subscription.created":
                        case "subscription.revoked":
                        case "subscription.uncanceled":
                        case "subscription.active": {
                          await callbackRuntime
                            .runPromise(
                              BillingRepository.use((billingRepository) =>
                                billingRepository.upsertSubscription(
                                  payload.data
                                )
                              )
                            )
                            .then(() => undefined);
                          break;
                        }
                        default: {
                          return;
                        }
                      }
                    },
                  }),
                ],
              }),
            ]
          : []),

        ...(Option.isSome(turnstileKey)
          ? [
              captcha({
                provider: "cloudflare-turnstile",
                secretKey: turnstileKey.value,
                endpoints: ["/sign-up/email"],
              }),
            ]
          : []),

        customSession(async ({ user, session }) => {
          const memberships = await callbackRuntime.runPromise(
            db
              .select({
                userId: schema.memberTable.userId,
                organizationId: schema.memberTable.organizationId,
                role: schema.memberTable.role,
                membershipId: schema.memberTable.id,
              })
              .from(schema.memberTable)
              .where(eq(schema.memberTable.userId, session.userId))
          );

          const organizations = memberships.map((membership) => ({
            id: membership.organizationId,
          }));

          return {
            organizations,
            memberships,
            user,
            session,
          };
        }, baseConfig),
        admin(),

        lastLoginMethod({
          storeInDatabase: true,
        }),
        organization({
          allowUserToCreateOrganization: false,
          // Roles mirror @feeblo/permissions. better-auth's own ACL only gates
          // org-plugin endpoints (invite/remove/update role/team); the Feeblo
          // permission table in packages/permissions gates everything else.
          ac: organizationAccessControl,
          roles: ORGANIZATION_ROLES,
          organizationHooks: {
            async beforeCreateInvitation(data) {
              await runCallbackPolicy(
                MembershipPolicy.use((policy) =>
                  policy.canInviteRoleWithinPlan({
                    organizationId: data.organization.id,
                    role: data.invitation.role,
                  })
                )
              );
            },
            async beforeUpdateMemberRole(data) {
              await runCallbackPolicy(
                MembershipPolicy.use((policy) =>
                  policy.canChangeRoleWithinPlan({
                    organizationId: data.organization.id,
                    currentRole: data.member.role,
                    newRole: data.newRole,
                  })
                )
              );
            },
            // Cancels the Polar subscription before the org row (and its
            // cascaded subscription/site rows) disappear, so the subdomain is
            // released and billing stops for the deleted tenant.
            async beforeDeleteOrganization(data) {
              await cancelOrganizationSubscription(data.organization.id);
            },
          },
          async sendInvitationEmail(data) {
            const inviteLink = `${appUrl}/invitation/${data.id}`;
            const { createOrganizationInvitationEmail } =
              await loadOrganizationInvitationEmail();
            await callbackRuntime.runPromise(
              Mailer.use((mailer) =>
                mailer.send({
                  to: data.email,
                  ...createOrganizationInvitationEmail({
                    inviteUrl: inviteLink,
                    organizationName: data.organization.name,
                    inviterName: data.inviter.user.name,
                    role: data.role,
                  }),
                })
              )
            );
          },
        }),
        emailOTP({
          disableSignUp: true,
          expiresIn: 8 * 60, // 8 minutes
          overrideDefaultEmailVerification: true,

          async sendVerificationOTP({ email, otp, type }, ctx) {
            // Some Better Auth flows invoke this callback directly instead of
            // dispatching the email-OTP endpoint, so hooks.before does not run.
            // Keep those sends rate limited, while avoiding a second consume
            // for paths already handled by the request hook.
            if (!(ctx && verificationOtpRateLimitedPaths.has(ctx.path))) {
              await consumeVerificationOtpRateLimitForFlow(
                type === "forget-password"
                  ? "password-reset"
                  : type === "sign-in"
                    ? "sign-in"
                    : "email-verification",
                email
              );
            }
            const flowLabel =
              type === "forget-password"
                ? "password reset"
                : type === "sign-in"
                  ? "sign-in"
                  : "email verification";
            const { createVerificationOtpEmail } =
              await loadVerificationOtpEmail();

            await callbackRuntime.runPromise(
              Mailer.use((mailer) =>
                mailer.send({
                  to: email,
                  ...createVerificationOtpEmail({
                    otp,
                    flowLabel,
                  }),
                })
              )
            );
          },
        }),

        ...(isTest ? [createTestUtilsPlugin()] : []),
      ],

      hooks: {
        before: createAuthMiddleware(async (ctx) => {
          if (
            (ctx.path.startsWith("/sign-in") ||
              ctx.path.startsWith("/sign-up") ||
              ctx.path.startsWith("/email-otp")) &&
            ctx.body?.email &&
            isString(ctx.body.email)
          ) {
            if (
              isEmailBlocked(
                ctx.body.email,
                Option.getOrUndefined(allowedEmails)
              )
            ) {
              throw new APIError("BAD_REQUEST", {
                code: "EMAIL_BLOCKED",
                message:
                  "This email address is not allowed. Please use a different email or contact support.",
              });
            }
            if (isTemporaryEmail(ctx.body.email)) {
              throw new APIError("BAD_REQUEST", {
                code: "TEMPORARY_EMAIL_NOT_ALLOWED",
                message:
                  "Temporary email addresses are not allowed. Please use a different email.",
              });
            }
          }

          await consumeVerificationOtpRateLimit(ctx);
        }),
      },
      databaseHooks: {
        session: {
          create: {
            async after(session, context) {
              //TODO update only once
              await updateTimeZone(
                session.userId,
                context?.getHeader(clientTimeZoneHeader)
              );
            },
          },
        },
      },
      user: {
        additionalFields: {
          restrictedToOrganizationId: {
            type: "string",
            required: false,
          },
          timezone: {
            type: "string",
            required: false,
          },
        },
      },
    } satisfies BetterAuthOptions;
    return betterAuth(config);
  }).pipe(
    Effect.provide(
      Layer.mergeAll(
        AuthConfig.layer,
        PolarService.layer,
        BillingRepository.layer,
        MembershipRepository.layer,
        makeMailerLayer(),
        rateLimitLayer,
        WorkspaceRepository.layer
      )
    )
  );

export type AuthClientMembership = {
  membershipId: string;
  organizationId: string;
  role: Role;
  userId: string;
};

export type AuthClientOrganization = {
  id: string;
};

export type Auth = Effect.Success<ReturnType<typeof initAuthHandler>>;
export type Session = Auth["$Infer"]["Session"] & {
  memberships: AuthClientMembership[];
  organizations: AuthClientOrganization[];
};

export const auth: ReturnType<typeof initAuthHandler> = initAuthHandler();
