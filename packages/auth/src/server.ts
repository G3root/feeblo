/** biome-ignore-all lint/style/noNestedTernary: <explanation> */

import { Database } from "@feeblo/db";
import * as schema from "@feeblo/db/schema";
import { BillingRepository } from "@feeblo/domain/billing/repository";
import { PolarService } from "@feeblo/domain/billing/service";
import { EntitlementPolicy } from "@feeblo/domain/entitlement/policies";
import { MembershipRepository } from "@feeblo/domain/membership/repository";
import { isPrivilegedMemberRole } from "@feeblo/domain/plan-entitlements";
import { PolicyDeniedError } from "@feeblo/domain/policy";
import {
  createSsoSession,
  linkAnonymousAccount,
  SsoError,
  SsoRepositoriesLive,
} from "@feeblo/domain/widget/sso";
import { WorkspaceRepository } from "@feeblo/domain/workspace/repository";
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
import { eq } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import { drizzleAdapter } from "./adapter/drizzzle-adapter";
import { AuthConfig } from "./config";
import { jwtAutoLogin } from "./plugins/jwt-auto-login/plugin";
import type { JwtAutoLoginOptions } from "./plugins/jwt-auto-login/types";
import { getTrustedOrigins, isEmailBlocked, isTemporaryEmail } from "./utils";

const loadPasswordResetEmail = () =>
  import("@feeblo/transactional/templates/password-reset");

const loadOrganizationInvitationEmail = () =>
  import("@feeblo/transactional/templates/organization-invitation");

const loadVerificationOtpEmail = () =>
  import("@feeblo/transactional/templates/verification-otp");

const createTestUtilsPlugin = (): BetterAuthPlugin =>
  testUtils({ captureOTP: true }) as unknown as BetterAuthPlugin;

export const initAuthHandler = () =>
  Effect.gen(function* () {
    const {
      appUrl,
      apiUrl,
      githubClientId,
      githubClientSecret,
      googleClientId,
      googleClientSecret,
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

    const dbLayer = Layer.succeed(Database.Database, db);

    const callbackRuntime = ManagedRuntime.make(
      Layer.mergeAll(
        PolarService.layer,
        BillingRepository.layer,
        EntitlementPolicy.layer.pipe(Layer.provide(WorkspaceRepository.layer)),
        MembershipRepository.layer,
        Mailer.layer,
        WorkspaceRepository.layer,
        SsoRepositoriesLive
      ).pipe(Layer.provideMerge(dbLayer))
    );

    const ssoOptions: JwtAutoLoginOptions = {
      createSsoUser: async ({ organizationId, token }) => {
        try {
          return await callbackRuntime.runPromise(
            createSsoSession({ organizationId, token })
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

    const mapPolicyDeniedToApiError = (error: unknown) => {
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

    const canAssignPrivilegedRole = (organizationId: string) =>
      Effect.gen(function* () {
        const entitlementPolicy = yield* EntitlementPolicy;
        const membershipRepository = yield* MembershipRepository;

        yield* entitlementPolicy.canAssignPrivilegedRole({
          organizationId,
          privilegedRoleCount: Effect.gen(function* () {
            const privilegedMembersCount =
              yield* membershipRepository.countPrivilegedMembers({
                organizationId,
              });
            const pendingPrivilegedInvitationsCount =
              yield* membershipRepository.countPendingPrivilegedInvitations({
                organizationId,
              });

            return privilegedMembersCount + pendingPrivilegedInvitationsCount;
          }),
        });
      });

    const baseConfig = {
      plugins: [jwtAutoLogin(ssoOptions)],
    } satisfies BetterAuthOptions;

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
      ...((githubClientId._tag === "Some" &&
        githubClientSecret._tag === "Some") ||
      (googleClientId._tag === "Some" && googleClientSecret._tag === "Some")
        ? {
            socialProviders: {
              ...(githubClientId._tag === "Some" &&
              githubClientSecret._tag === "Some"
                ? {
                    github: {
                      clientId: githubClientId.value,
                      clientSecret: githubClientSecret.value,
                      disableSignUp: !signUpEnabled,
                      disableImplicitSignUp: !signUpEnabled,
                    },
                  }
                : {}),
              ...(googleClientId._tag === "Some" &&
              googleClientSecret._tag === "Some"
                ? {
                    google: {
                      prompt: "select_account",
                      clientId: googleClientId.value,
                      clientSecret: googleClientSecret.value,
                      disableSignUp: !signUpEnabled,
                      disableImplicitSignUp: !signUpEnabled,
                    },
                  }
                : {}),
            },
          }
        : {}),
      telemetry: {
        enabled: false,
      },
      trustedOrigins,

      advanced: {
        crossSubDomainCookies: {
          enabled: nodeEnv === "production",
          domain: appRootDomain,
        },
        defaultCookieAttributes: {
          secure: true,
          httpOnly: true,
          sameSite: "none", // Allows CORS-based cookie sharing across subdomains
        },
      },
      emailVerification: {
        autoSignInAfterVerification: true,
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
        ...(polarService.client && polarService.webhookSecret._tag === "Some"
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

        ...(turnstileKey._tag === "Some"
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
          organizationHooks: {
            async beforeCreateInvitation(data) {
              if (!isPrivilegedMemberRole(data.invitation.role)) {
                return;
              }

              await runCallbackPolicy(
                canAssignPrivilegedRole(data.organization.id)
              );
            },
            async beforeUpdateMemberRole(data) {
              if (
                !isPrivilegedMemberRole(data.newRole) ||
                isPrivilegedMemberRole(data.member.role)
              ) {
                return;
              }

              await runCallbackPolicy(
                canAssignPrivilegedRole(data.organization.id)
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
        emailOTP({
          disableSignUp: true,
          expiresIn: 8 * 60, // 8 minutes
          overrideDefaultEmailVerification: true,

          async sendVerificationOTP({ email, otp, type }) {
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
        // biome-ignore lint/suspicious/useAwait: <explanation>
        before: createAuthMiddleware(async (ctx) => {
          if (
            (ctx.path.startsWith("/sign-in") ||
              ctx.path.startsWith("/sign-up") ||
              ctx.path.startsWith("/email-otp")) &&
            ctx.body?.email &&
            typeof ctx.body.email === "string"
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
        }),
      },
      user: {
        additionalFields: {
          restrictedToOrganizationId: {
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
        Mailer.layer,
        WorkspaceRepository.layer
      )
    )
  );

export type AuthClientMembership = {
  membershipId: string;
  organizationId: string;
  role: "owner" | "admin" | "member";
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
