import { NodeCrypto } from "@effect/platform-node";
import { Database, transaction } from "@feeblo/db";
import * as schema from "@feeblo/db/schema";
import { BillingRepository } from "@feeblo/domain/billing/repository";
import { revokePendingSubscriptionRevocations } from "@feeblo/domain/billing/revocation";
import { PolarService } from "@feeblo/domain/billing/service";
import { EntitlementPolicy } from "@feeblo/domain/entitlement/policies";
import { healShadowsForVerifiedUser } from "@feeblo/domain/identity/linking";
import { MembershipPolicy } from "@feeblo/domain/membership/policies";
import { MembershipRepository } from "@feeblo/domain/membership/repository";
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
import { isString } from "@feeblo/utils/runtime-kind";
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
import type { ManagedRuntime as ManagedRuntimeType } from "effect/ManagedRuntime";
import * as Option from "effect/Option";
import type * as Redis from "effect/persistence/Redis";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import { WorkflowEngine } from "effect/workflow/WorkflowEngine";

import { drizzleAdapter } from "./adapter/drizzle-adapter";
import { enforcePublicApiKeyPlan, publicApiKeyPlugin } from "./api-key-config";
import { clientTimeZoneHeader, isValidTimeZone } from "./client-time-zone";
import { AuthConfig } from "./config";
import {
  ORGANIZATION_ROLES,
  organizationAccessControl,
} from "./organization-roles";
import { jwtAutoLogin } from "./plugins/jwt-auto-login/plugin";
import type { JwtAutoLoginOptions } from "./plugins/jwt-auto-login/types";
import { mapPolicyDeniedToApiError } from "./policy-api-error";
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
  rateLimitLayer: Layer.Layer<
    RateLimitService,
    Redis.RedisError
  > = RateLimitService.layerMemory
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

    // A half-configured Polar is the one failure mode that takes money without
    // granting a plan: checkout and the portal need only the access token, but
    // the signed webhook endpoint (the only way a subscription reaches this
    // deployment) is registered only when the secret is present too.
    if (polarService.client && Option.isNone(polarService.webhookSecret)) {
      yield* Effect.logWarning(
        "POLAR_ACCESS_TOKEN is set without POLAR_WEBHOOK_SECRET: checkout can charge a card, but subscription webhooks will never be applied"
      );
    }

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

    /**
     * Heals `behalf-*` shadow identities into a freshly verified real
     * account. Runs after email verification and after any signup that
     * already carries a verified email (e.g. OAuth). The program itself
     * guards on verification, exact email match, and shadow-only links, so a
     * failure or a non-match can never corrupt another identity — and a
     * healing error must never block the authentication flow.
     */
    const healShadowIdentities = (user: { readonly id: string }) =>
      callbackRuntime.runPromise(
        healShadowsForVerifiedUser({ userId: user.id }).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning(
              "Failed to heal shadow identities for verified user",
              cause
            ).pipe(Effect.annotateLogs({ userId: user.id }))
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
          // The plugin may hand back an error that crossed a request
          // boundary, so match on the tag rather than the prototype.
          if (Schema.is(SsoError)(error)) {
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

    const runCallbackPolicy = async <A, E>(
      effect: Effect.Effect<
        A,
        E,
        typeof callbackRuntime extends ManagedRuntimeType<infer R, unknown>
          ? R
          : never
      >
    ) => {
      try {
        await callbackRuntime.runPromise(effect);
      } catch (error) {
        throw mapPolicyDeniedToApiError(error);
      }
    };

    /**
     * Writes every subscription a workspace holds into the durable revocation
     * queue, while the subscription rows still exist. A failure to queue must
     * not block the deletion, so it logs and the queue is simply empty — the
     * same best-effort read the old unconditional revocation had, now with a
     * retry loop behind every row that did make it in.
     */
    const enqueueOrganizationSubscriptionRevocations = (
      organizationId: string
    ) =>
      callbackRuntime.runPromise(
        BillingRepository.use((billingRepository) =>
          billingRepository.enqueueSubscriptionRevocationsForOrganization({
            organizationId,
            polarServer: polarService.target,
          })
        ).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning(
              "Failed to queue billing revocation for a deleted organization",
              cause
            ).pipe(Effect.annotateLogs({ organizationId }))
          )
        )
      );

    /**
     * Attempts every queued revocation for a workspace whose row is already
     * gone. Polar failures stay queued for `subscriptionRevocationMaintenance`;
     * only a database failure surfaces here and is logged.
     */
    const revokePendingOrganizationSubscriptions = (organizationId: string) =>
      callbackRuntime.runPromise(
        revokePendingSubscriptionRevocations({ organizationId }).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning(
              "Failed to revoke queued billing for a deleted organization",
              cause
            ).pipe(Effect.annotateLogs({ organizationId }))
          )
        )
      );

    /**
     * Deletes the workspaces a departing account is the only member of, and
     * refuses the deletion while a workspace it owns still has teammates.
     *
     * A `member` row cascades with the user, but the organization does not: a
     * workspace whose only owner deleted their account would keep its posts,
     * integrations, and billing subscription with nobody able to reach it — or
     * delete it. Deleting it along with the account is what makes the account
     * deletion an actual erasure. A workspace with other members is the
     * opposite case: deleting it would destroy their data as a side effect of
     * one person leaving, so it blocks the deletion and names itself instead.
     */
    const deleteWorkspacesSolelyOwnedBy = async (userId: string) => {
      const ownershipRequiredError = (workspaceNames: readonly string[]) =>
        new APIError("BAD_REQUEST", {
          code: "WORKSPACE_OWNERSHIP_REQUIRED",
          message: `${workspaceNames.join(", ")} still has other members. Remove them in Members settings, or delete the workspace, before deleting your account.`,
        });

      const countMembers = (organizationId: string, lock: boolean) =>
        Effect.gen(function* () {
          const members = db
            .select({ id: schema.memberTable.id })
            .from(schema.memberTable)
            .where(eq(schema.memberTable.organizationId, organizationId));
          if (!lock) {
            return (yield* members).length;
          }
          // `FOR UPDATE` only means anything inside the deletion transaction.
          return (yield* members.for("update")).length;
        });

      const ownedWorkspaces = await callbackRuntime.runPromise(
        Effect.gen(function* () {
          const memberships = yield* db
            .select({
              id: schema.organizationTable.id,
              name: schema.organizationTable.name,
              role: schema.memberTable.role,
            })
            .from(schema.memberTable)
            .innerJoin(
              schema.organizationTable,
              eq(schema.organizationTable.id, schema.memberTable.organizationId)
            )
            .where(eq(schema.memberTable.userId, userId));
          return memberships.filter((membership) =>
            membership.role.split(",").includes("owner")
          );
        })
      );
      if (ownedWorkspaces.length === 0) {
        return;
      }

      // Checked before anything is revoked or deleted: a refusal must not
      // touch the billing of a workspace that is staying.
      const blockingWorkspaceNames = await callbackRuntime.runPromise(
        Effect.gen(function* () {
          const blocking: string[] = [];
          for (const workspace of ownedWorkspaces) {
            if ((yield* countMembers(workspace.id, false)) > 1) {
              blocking.push(workspace.name);
            }
          }
          return blocking;
        })
      );
      if (blockingWorkspaceNames.length > 0) {
        throw ownershipRequiredError(blockingWorkspaceNames);
      }

      // Every deletion commits or none does, and the membership count is
      // re-checked under a lock: an invitation accepted between the check above
      // and here must fail the whole deletion rather than take a workspace away
      // from the member who just joined. The revocation rows are written in
      // this transaction, before the organization row (and its cascaded
      // subscriptions) disappears, so a rollback leaves no queue work and no
      // revoked subscription for a workspace that survives.
      const deletedWorkspaceIds = await callbackRuntime.runPromise(
        transaction(
          Effect.gen(function* () {
            const nowBlocking: string[] = [];
            const deletable: string[] = [];
            for (const workspace of ownedWorkspaces) {
              const [locked] = yield* db
                .select({ id: schema.organizationTable.id })
                .from(schema.organizationTable)
                .where(eq(schema.organizationTable.id, workspace.id))
                .for("update");
              if (locked === undefined) {
                continue;
              }
              if ((yield* countMembers(workspace.id, true)) > 1) {
                nowBlocking.push(workspace.name);
              } else {
                deletable.push(workspace.id);
              }
            }
            if (nowBlocking.length > 0) {
              return yield* Effect.fail(ownershipRequiredError(nowBlocking));
            }
            for (const workspaceId of deletable) {
              yield* BillingRepository.use((billingRepository) =>
                billingRepository.enqueueSubscriptionRevocationsForOrganization(
                  {
                    organizationId: workspaceId,
                    polarServer: polarService.target,
                  }
                )
              );
              yield* db
                .delete(schema.organizationTable)
                .where(eq(schema.organizationTable.id, workspaceId));
            }
            return deletable;
          })
        )
      );

      // Revoked after the commit: an external call must not hold the
      // transaction's row locks, a workspace the re-check spared keeps the
      // subscription it still needs, and anything Polar refuses stays queued
      // for `subscriptionRevocationMaintenance`.
      for (const workspaceId of deletedWorkspaceIds) {
        await revokePendingOrganizationSubscriptions(workspaceId);
      }
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
          apikey: schema.apiKeyTable,
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
          await healShadowIdentities(user);
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
                // Off on purpose. The plugin creates a customer per user with
                // `externalId = user.id` and, on account deletion, deletes a
                // customer matched only by email — which is the customer a
                // workspace checkout's `externalCustomerId = organizationId`
                // resolves to, because Polar looks a checkout customer up by
                // email before external id. That combination cancels a
                // surviving workspace's subscription when the person who paid
                // deletes their account. Feeblo owns customer creation at
                // checkout (`PolarService.createCheckout`); the plugin is here
                // only for the signed webhook endpoint.
                createCustomerOnSignUp: false,

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
                        case "subscription.active":
                        case "subscription.past_due": {
                          await callbackRuntime
                            .runPromise(
                              BillingRepository.use((billingRepository) =>
                                billingRepository.upsertSubscription(
                                  payload.data,
                                  payload.timestamp
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
            // Queues the Polar subscription for revocation before the org row
            // (and its cascaded subscription/site rows) disappears, so the
            // external subscription id is still readable. The revocation runs
            // in the after hook once the deletion has committed, and anything
            // Polar refuses stays queued; the revocation retry loop will not
            // touch it while the organization row still exists.
            async beforeDeleteOrganization(data) {
              await enqueueOrganizationSubscriptionRevocations(
                data.organization.id
              );
            },
            async afterDeleteOrganization(data) {
              await revokePendingOrganizationSubscriptions(
                data.organization.id
              );
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

        // Organization-owned machine credentials for the Public API. The
        // plugin owns credential material; every authorization decision stays
        // with Feeblo (`apiKeys.manage` and the `publicApi` entitlement at
        // creation, key scopes per request in the Public API middleware). Its
        // own endpoints are additionally gated by the `apiKey` statements in
        // `organizationAccessControl`, which is why those grants exist.
        publicApiKeyPlugin,

        emailOTP({
          disableSignUp: true,
          expiresIn: 8 * 60, // 8 minutes
          overrideDefaultEmailVerification: true,
          // Never persist verification codes in plaintext: the verification
          // table would otherwise expose usable password-reset and
          // email-verification OTPs to anyone with database read access.
          storeOTP: "hashed",

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
          // The mounted `/api-key/create` route authorizes through the
          // organization ACL, which decides *who* may hold a credential but
          // cannot see billing. Apply the same `publicApi` entitlement the
          // dashboard RPC applies, so a Free workspace cannot mint a key by
          // calling the plugin's route directly.
          await enforcePublicApiKeyPlan(ctx, (organizationId) =>
            runCallbackPolicy(
              EntitlementPolicy.use((policy) =>
                policy.canUsePublicApi(organizationId)
              )
            )
          );

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
        user: {
          // Signups that arrive already verified (verification disabled, or
          // OAuth providers returning verified addresses) never pass through
          // afterEmailVerification, so heal immediately on creation. The
          // program no-ops for unverified users.
          create: {
            async after(user) {
              await healShadowIdentities(user);
            },
          },
        },
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
        // Better Auth registers /delete-user only when this is enabled; the
        // dashboard's Danger Zone calls it. A password, when the account has
        // one, or a session fresher than `session.freshAge` is required by
        // better-auth itself, and `beforeDelete` cascades the workspaces the
        // account is the only member of so erasure is actually complete.
        deleteUser: {
          enabled: true,
          async beforeDelete(user) {
            await deleteWorkspacesSolelyOwnedBy(user.id);
          },
        },
      },
    } satisfies BetterAuthOptions;
    return betterAuth(config);
  }).pipe(
    // initAuthHandler runs once at server composition to build the auth
    // handler; this is that composition's entry point.
    // eslint-disable-next-line effecttsgo/strict-effect-provide -- composition entry point
    Effect.provide(
      Layer.mergeAll(
        AuthConfig.layer,
        PolarService.layer,
        BillingRepository.layer,
        MembershipRepository.layer,
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
