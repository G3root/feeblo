/** biome-ignore-all lint/style/noNestedTernary: <explanation> */

import { Database } from "@feeblo/db";
import * as schema from "@feeblo/db/schema";
import { BillingRepository } from "@feeblo/domain/billing/repository";
import { PolarService } from "@feeblo/domain/billing/service";
import { MembershipRepository } from "@feeblo/domain/membership/repository";
import {
  isPrivilegedMemberRole,
  PLAN_ENTITLEMENTS,
} from "@feeblo/domain/plan-entitlements";
import { WorkspaceRepository } from "@feeblo/domain/workspace/repository";
import { Mailer } from "@feeblo/transactional/mailer";
import { polar, webhooks } from "@polar-sh/better-auth";
import { type BetterAuthOptions, betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware } from "better-auth/api";
import {
  admin,
  captcha,
  customSession,
  emailOTP,
  lastLoginMethod,
  organization,
} from "better-auth/plugins";
import { eq } from "drizzle-orm";
import { Effect, Layer, ManagedRuntime, Option, Redacted } from "effect";
import { AuthConfig } from "./config";
import { getTrustedOrigins, isEmailBlocked, isTemporaryEmail } from "./utils";

const loadPasswordResetEmail = () =>
  import("@feeblo/transactional/templates/password-reset");

const loadOrganizationInvitationEmail = () =>
  import("@feeblo/transactional/templates/organization-invitation");

const loadVerificationOtpEmail = () =>
  import("@feeblo/transactional/templates/verification-otp");

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
    } = yield* AuthConfig;
    const polarService = yield* PolarService;

    const trustedOrigins = yield* getTrustedOrigins;
    const db = yield* Database.Database;
    const context = yield* Effect.context<
      Database.Database | AuthConfig | PolarService
    >();
    const callbackRuntime = ManagedRuntime.make(
      Layer.mergeAll(
        PolarService.layer,
        BillingRepository.layer,
        MembershipRepository.layer,
        Mailer.layer,
        WorkspaceRepository.layer
      ).pipe(Layer.provide(Layer.succeed(Database.Database, db)))
    );

    const config = {
      database: drizzleAdapter(db.db, {
        provider: "pg",

        schema,
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

        requireEmailVerification: true,
        autoSignIn: false,
      },
      plugins: [
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
          const memberships = await Effect.runPromiseWith(context)(
            db.execute((client) =>
              client
                .select({
                  userId: schema.member.userId,
                  organizationId: schema.member.organizationId,
                  role: schema.member.role,
                  membershipId: schema.member.id,
                })
                .from(schema.member)
                .where(eq(schema.member.userId, session.userId))
            )
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
        }),
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

              await callbackRuntime.runPromise(
                Effect.gen(function* () {
                  const workspaceRepository = yield* WorkspaceRepository;
                  const membershipRepository = yield* MembershipRepository;

                  const planState =
                    yield* workspaceRepository.findPlanByOrganizationId({
                      organizationId: data.organization.id,
                    });
                  const entitlements = PLAN_ENTITLEMENTS[planState.plan];

                  if (entitlements.privilegedRoleLimit === null) {
                    return;
                  }

                  const privilegedMembersCount =
                    yield* membershipRepository.countPrivilegedMembers({
                      organizationId: data.organization.id,
                    });
                  const pendingPrivilegedInvitationsCount =
                    yield* membershipRepository.countPendingPrivilegedInvitations(
                      {
                        organizationId: data.organization.id,
                      }
                    );

                  if (
                    privilegedMembersCount +
                      pendingPrivilegedInvitationsCount >=
                    entitlements.privilegedRoleLimit
                  ) {
                    return yield* Effect.fail(
                      new APIError("FORBIDDEN", {
                        message: `The ${planState.plan} plan allows up to ${entitlements.privilegedRoleLimit} admin roles.`,
                      })
                    );
                  }
                })
              );
            },
            async beforeUpdateMemberRole(data) {
              if (
                !isPrivilegedMemberRole(data.newRole) ||
                isPrivilegedMemberRole(data.member.role)
              ) {
                return;
              }

              await callbackRuntime.runPromise(
                Effect.gen(function* () {
                  const workspaceRepository = yield* WorkspaceRepository;
                  const membershipRepository = yield* MembershipRepository;

                  const planState =
                    yield* workspaceRepository.findPlanByOrganizationId({
                      organizationId: data.organization.id,
                    });
                  const entitlements = PLAN_ENTITLEMENTS[planState.plan];

                  if (entitlements.privilegedRoleLimit === null) {
                    return;
                  }

                  const privilegedMembersCount =
                    yield* membershipRepository.countPrivilegedMembers({
                      organizationId: data.organization.id,
                    });
                  const pendingPrivilegedInvitationsCount =
                    yield* membershipRepository.countPendingPrivilegedInvitations(
                      {
                        organizationId: data.organization.id,
                      }
                    );

                  if (
                    privilegedMembersCount +
                      pendingPrivilegedInvitationsCount >=
                    entitlements.privilegedRoleLimit
                  ) {
                    return yield* Effect.fail(
                      new APIError("FORBIDDEN", {
                        message: `The ${planState.plan} plan allows up to ${entitlements.privilegedRoleLimit} admin roles.`,
                      })
                    );
                  }
                })
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

export type Auth = Effect.Success<ReturnType<typeof initAuthHandler>>;
export type Session = Auth["$Infer"]["Session"];

export const auth: ReturnType<typeof initAuthHandler> = initAuthHandler();
