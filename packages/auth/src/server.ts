/** biome-ignore-all lint/style/noNestedTernary: <explanation> */
import { DB } from "@feeblo/db";
import * as schema from "@feeblo/db/schema/index";
import { BillingRepository } from "@feeblo/domain/billing/repository";
import { PolarService } from "@feeblo/domain/billing/service";
import {
  createOrganizationInvitationEmail,
  createPasswordResetEmail,
  createVerificationOtpEmail,
  Mailer,
} from "@feeblo/transactional";
import { polar, webhooks } from "@polar-sh/better-auth";
import { type BetterAuthOptions, betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import {
  admin,
  customSession,
  emailOTP,
  lastLoginMethod,
  organization,
} from "better-auth/plugins";
import { eq } from "drizzle-orm";
import { Config, Effect, Layer, ManagedRuntime, Redacted } from "effect";

export const initAuthHandler = () =>
  Effect.gen(function* () {
    const optionalString = (name: string) =>
      Config.string(name).pipe(
        Config.option,
        Effect.map((value) =>
          value._tag === "Some" && value.value.trim() !== ""
            ? value
            : { _tag: "None" as const }
        )
      );

    const appUrl = yield* Config.string("VITE_APP_URL");
    const apiUrl = yield* Config.string("VITE_API_URL");
    const secret = yield* Config.redacted("AUTH_ENCRYPTION_KEY");
    const githubClientId = yield* optionalString("GITHUB_CLIENT_ID");
    const githubClientSecret = yield* optionalString("GITHUB_CLIENT_SECRET");
    const googleClientId = yield* optionalString("GOOGLE_CLIENT_ID");
    const googleClientSecret = yield* optionalString("GOOGLE_CLIENT_SECRET");
    const polarService = yield* PolarService;

    const db = yield* DB;
    const callbackRuntime = ManagedRuntime.make(
      Layer.mergeAll(
        PolarService.layer,
        BillingRepository.layer,
        Mailer.layer
      ).pipe(Layer.provide(Layer.succeed(DB, db)))
    );

    const config = {
      database: drizzleAdapter(db, {
        provider: "pg",

        schema,
      }),
      baseURL: appUrl,
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
                    },
                  }
                : {}),
            },
          }
        : {}),
      telemetry: {
        enabled: false,
      },
      trustedOrigins: [appUrl, apiUrl, "*.localhost:3001"],

      advanced: {
        defaultCookieAttributes: {
          secure: true,
          httpOnly: true,
          sameSite: "none", // Allows CORS-based cookie sharing across subdomains
          partitioned: true, // New browser standards will mandate this for foreign cookies
        },
      },
      emailVerification: {
        autoSignInAfterVerification: true,
      },
      emailAndPassword: {
        enabled: true,

        async sendResetPassword(data) {
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

        customSession(async ({ user, session }) => {
          const memberships = await db
            .select({
              userId: schema.member.userId,
              organizationId: schema.member.organizationId,
              role: schema.member.role,
              membershipId: schema.member.id,
            })
            .from(schema.member)
            .where(eq(schema.member.userId, session.userId));

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
          async sendInvitationEmail(data) {
            const inviteLink = `${appUrl}/invitation/${data.id}`;
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
    } satisfies BetterAuthOptions;
    return betterAuth(config);
  }).pipe(
    Effect.provide(
      Layer.mergeAll(PolarService.layer, BillingRepository.layer, Mailer.layer)
    )
  );

export type Auth = Effect.Effect.Success<ReturnType<typeof initAuthHandler>>;
export type Session = Auth["$Infer"]["Session"];

export const auth = initAuthHandler();
