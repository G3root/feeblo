import { DB } from "@feeblo/db";
import * as schema from "@feeblo/db/schema/index";
import { polar, webhooks } from "@polar-sh/better-auth";
import { Polar } from "@polar-sh/sdk";
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
import { Config, Effect, Redacted } from "effect";

interface PolarClient {
  accessToken: string;
  server: "sandbox" | "production";
}

const getPolarClient = (client: PolarClient) => new Polar(client);

export const initAuthHandler = () =>
  Effect.gen(function* () {
    const appUrl = yield* Config.string("VITE_APP_URL");
    const apiUrl = yield* Config.string("VITE_API_URL");
    const secret = yield* Config.redacted("AUTH_ENCRYPTION_KEY");
    const polarAccessToken = yield* Config.redacted("POLAR_ACCESS_TOKEN").pipe(
      Config.option
    );
    const polarWebhookSecret = yield* Config.redacted(
      "POLAR_WEBHOOK_SECRET"
    ).pipe(Config.option);
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
        // biome-ignore lint/suspicious/useAwait: <explanation>
        async sendResetPassword(data) {
          console.log({ data });
        },

        requireEmailVerification: true,
        autoSignIn: false,
      },
      user: {
        additionalFields: {
          onboardedOn: {
            type: "date",
            required: false,
          },
        },
      },

      plugins: [
        ...(polarAccessToken._tag === "Some" &&
        polarWebhookSecret._tag === "Some"
          ? [
              polar({
                client: getPolarClient({
                  accessToken: polarAccessToken.value.pipe(Redacted.value),
                  server: "sandbox",
                }),
                createCustomerOnSignUp: true,
                use: [
                  // checkout({
                  //   products: [
                  //     {
                  //       productId: "123-456-789", // ID of Product from Polar Dashboard
                  //       slug: "pro", // Custom slug for easy reference in Checkout URL, e.g. /checkout/pro
                  //     },
                  //   ],
                  //   successUrl: "/success?checkout_id={CHECKOUT_ID}",
                  //   authenticatedUsersOnly: true,
                  // }),
                  // portal(),

                  webhooks({
                    secret: polarWebhookSecret.value.pipe(Redacted.value),
                  }),
                ],
              }),
            ]
          : []),

        customSession(async ({ user, session }) => {
          const organizations = await db
            .select({ id: schema.member.organizationId })
            .from(schema.member)
            .where(eq(schema.member.userId, session.userId));
          const userWithOnboarding = user as typeof user & {
            onboardedOn?: Date | null;
          };

          return {
            organizations,
            user: {
              ...user,
              onboardedOn: userWithOnboarding.onboardedOn ?? null,
            },
            session,
          };
        }),
        admin(),

        lastLoginMethod({
          storeInDatabase: true,
        }),
        organization({
          allowUserToCreateOrganization: false,
          // biome-ignore lint/suspicious/useAwait: <explanation>
          async sendInvitationEmail(data) {
            const inviteLink = `${appUrl}/invitation/${data.id}`;
            console.log({ inviteLink });
          },
        }),
        emailOTP({
          disableSignUp: true,
          expiresIn: 8 * 60, // 8 minutes
          overrideDefaultEmailVerification: true,
          // biome-ignore lint/suspicious/useAwait: <explanation>
          async sendVerificationOTP({ email, otp }) {
            console.log({ email, otp });
          },
        }),
      ],
    } satisfies BetterAuthOptions;
    return betterAuth(config);
  });

export type Auth = Effect.Effect.Success<ReturnType<typeof initAuthHandler>>;
export type Session = Auth["$Infer"]["Session"];

export const auth = initAuthHandler();
