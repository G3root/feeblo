import { DB } from "@feeblo/db";
import * as schema from "@feeblo/db/schema/index";
import { BillingRepository } from "@feeblo/domain/billing/repository";
import { PolarService } from "@feeblo/domain/billing/service";
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
import { Config, Effect, Layer, Redacted } from "effect";

export const initAuthHandler = () =>
  Effect.gen(function* () {
    const appUrl = yield* Config.string("VITE_APP_URL");
    const apiUrl = yield* Config.string("VITE_API_URL");
    const secret = yield* Config.redacted("AUTH_ENCRYPTION_KEY");
    const billingRepository = yield* BillingRepository;
    const polarService = yield* PolarService;

    const db = yield* DB;

    const config = {
      database: drizzleAdapter(db, {
        provider: "pg",

        schema,
      }),
      baseURL: appUrl,
      secret: Redacted.value(secret),
      telemetry: {
        enabled: false,
      },
      trustedOrigins: [appUrl, apiUrl],

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
        // biome-ignore lint/suspicious/useAwait: callback signature requires async
        async sendResetPassword(data) {
          console.log({ data });
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
                        case "product.created": {
                          await Effect.runPromise(
                            billingRepository.createProduct(payload.data)
                          ).then(() => undefined);
                          break;
                        }
                        case "product.updated": {
                          await Effect.runPromise(
                            billingRepository.updateProduct(payload.data)
                          ).then(() => undefined);
                          break;
                        }
                        case "subscription.created": {
                          await Effect.runPromise(
                            billingRepository.createSubscription(payload.data)
                          ).then(() => undefined);
                          break;
                        }
                        case "subscription.updated":
                        case "subscription.canceled":
                        case "subscription.revoked":
                        case "subscription.uncanceled":
                        case "subscription.active": {
                          await Effect.runPromise(
                            billingRepository.updateSubscription(payload.data)
                          ).then(() => undefined);
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
          // biome-ignore lint/suspicious/useAwait: callback signature requires async
          async sendInvitationEmail(data) {
            const inviteLink = `${appUrl}/invitation/${data.id}`;
            console.log({ inviteLink });
          },
        }),
        emailOTP({
          disableSignUp: true,
          expiresIn: 8 * 60, // 8 minutes
          overrideDefaultEmailVerification: true,
          // biome-ignore lint/suspicious/useAwait: callback signature requires async
          async sendVerificationOTP({ email, otp }) {
            console.log({ email, otp });
          },
        }),
      ],
    } satisfies BetterAuthOptions;
    return betterAuth(config);
  }).pipe(
    Effect.provide(
      Layer.mergeAll(PolarService.Default, BillingRepository.Default)
    )
  );

export type Auth = Effect.Effect.Success<ReturnType<typeof initAuthHandler>>;
export type Session = Auth["$Infer"]["Session"];

export const auth = initAuthHandler();
