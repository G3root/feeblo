import { DB } from "@feeblo/db";
import * as schema from "@feeblo/db/schema/index";
import { generateId } from "@feeblo/utils/id";
import { polar, webhooks } from "@polar-sh/better-auth";
import { Polar } from "@polar-sh/sdk";
import type { WebhookProductCreatedPayload } from "@polar-sh/sdk/models/components/webhookproductcreatedpayload";
import type { WebhookSubscriptionCreatedPayload } from "@polar-sh/sdk/models/components/webhooksubscriptioncreatedpayload";
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
import { Config, Effect, Redacted, Schema } from "effect";

interface PolarClient {
  accessToken: string;
  server: "sandbox" | "production";
}

const getPolarClient = (client: PolarClient) => new Polar(client);

type SubscriptionPayload = WebhookSubscriptionCreatedPayload["data"];

type ProductPayload = WebhookProductCreatedPayload["data"];
export const initAuthHandler = () =>
  Effect.gen(function* () {
    const appUrl = yield* Config.string("VITE_APP_URL");
    const apiUrl = yield* Config.string("VITE_API_URL");
    const secret = yield* Config.redacted("AUTH_ENCRYPTION_KEY");

    //Polar Configuration
    const polarAccessToken = yield* Config.redacted("POLAR_ACCESS_TOKEN").pipe(
      Config.option
    );
    const polarMode = yield* Schema.Config(
      "POLAR_MODE",
      Schema.Literal("sandbox", "production")
    ).pipe(Config.withDefault("sandbox"));
    const polarWebhookSecret = yield* Config.redacted(
      "POLAR_WEBHOOK_SECRET"
    ).pipe(Config.option);

    console.log({
      polarAccessToken:
        polarAccessToken._tag === "Some"
          ? Redacted.value(polarAccessToken.value)
          : undefined,
      polarMode,
      polarWebhookSecret:
        polarWebhookSecret._tag === "Some"
          ? Redacted.value(polarWebhookSecret.value)
          : undefined,
    });

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
                  server: polarMode,
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
                    onProductCreated(payload) {
                      return Effect.runPromise(
                        createProduct(payload.data).pipe(
                          Effect.provideService(DB, db)
                        )
                      );
                    },
                    onProductUpdated(payload) {
                      return Effect.runPromise(
                        updateProduct(payload.data).pipe(
                          Effect.provideService(DB, db)
                        )
                      );
                    },

                    onSubscriptionCreated: (payload) =>
                      Effect.runPromise(
                        createSubscription(payload.data).pipe(
                          Effect.provideService(DB, db)
                        )
                      ),
                    onSubscriptionUpdated: (payload) =>
                      Effect.runPromise(
                        updateSubscription(payload.data).pipe(
                          Effect.provideService(DB, db)
                        )
                      ),
                    onSubscriptionCanceled: (payload) =>
                      Effect.runPromise(
                        deleteSubscription(payload.data).pipe(
                          Effect.provideService(DB, db)
                        )
                      ),
                    onSubscriptionRevoked: (payload) =>
                      Effect.runPromise(
                        deleteSubscription(payload.data).pipe(
                          Effect.provideService(DB, db)
                        )
                      ),
                    onSubscriptionUncanceled: (payload) =>
                      Effect.runPromise(
                        updateSubscription(payload.data).pipe(
                          Effect.provideService(DB, db)
                        )
                      ),
                    onSubscriptionActive: (payload) =>
                      Effect.runPromise(
                        updateSubscription(payload.data).pipe(
                          Effect.provideService(DB, db)
                        )
                      ),
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
  });

export type Auth = Effect.Effect.Success<ReturnType<typeof initAuthHandler>>;
export type Session = Auth["$Infer"]["Session"];

export const auth = initAuthHandler();

const createSubscription = (payload: SubscriptionPayload) => {
  return Effect.gen(function* () {
    const db = yield* DB;

    yield* db.insert(schema.subscription).values({
      id: generateId("subscription"),
      externalId: payload.id,
      organizationId: payload.metadata.org as string,
      amount: payload.amount,
      cancelAtPeriodEnd: payload.cancelAtPeriodEnd,
      currency: payload.currency,
      recurringInterval: payload.recurringInterval,
      recurringIntervalCount: payload.recurringIntervalCount,
      status: payload.status,
      currentPeriodStart: payload.currentPeriodStart,
      currentPeriodEnd: payload.currentPeriodEnd,
      trialStart: payload.trialStart,
      trialEnd: payload.trialEnd,
      canceledAt: payload.canceledAt,
      startedAt: payload.startedAt,
      endsAt: payload.endsAt,
      endedAt: payload.endedAt,
      customerId: payload.customerId,
      productId: payload.productId,
      discountId: payload.discountId,
      checkoutId: payload.checkoutId,
      seats: payload.seats,
    });
  });
};

const updateSubscription = (payload: SubscriptionPayload) => {
  return Effect.gen(function* () {
    const db = yield* DB;

    const existingSubscription = yield* db
      .select({ id: schema.subscription.id })
      .from(schema.subscription)
      .where(eq(schema.subscription.externalId, payload.id));

    if (existingSubscription.length === 1) {
      yield* db
        .update(schema.subscription)
        .set({
          id: payload.id,
          amount: payload.amount,
          cancelAtPeriodEnd: payload.cancelAtPeriodEnd,
          currency: payload.currency,
          recurringInterval: payload.recurringInterval,
          recurringIntervalCount: payload.recurringIntervalCount,
          status: payload.status,
          currentPeriodStart: payload.currentPeriodStart,
          currentPeriodEnd: payload.currentPeriodEnd,
          trialStart: payload.trialStart,
          trialEnd: payload.trialEnd,
          canceledAt: payload.canceledAt,
          startedAt: payload.startedAt,
          endsAt: payload.endsAt,
          endedAt: payload.endedAt,
          customerId: payload.customerId,
          productId: payload.productId,
          discountId: payload.discountId,
          checkoutId: payload.checkoutId,
          seats: payload.seats,
          updatedAt: new Date(),
        })
        .where(eq(schema.subscription.externalId, payload.id));
    } else {
      yield* createSubscription(payload);
    }
  });
};

const deleteSubscription = (payload: SubscriptionPayload) => {
  return Effect.gen(function* () {
    const db = yield* DB;
    yield* db
      .delete(schema.subscription)
      .where(eq(schema.subscription.externalId, payload.id));
  });
};

const createProduct = (payload: ProductPayload) => {
  return Effect.gen(function* () {
    const db = yield* DB;
    yield* db.insert(schema.product).values({
      id: payload.id,
      name: payload.name,
      description: payload.description,
      trialInterval: payload.trialInterval,
      trialIntervalCount: payload.trialIntervalCount,
      recurringInterval: payload.recurringInterval,
      recurringIntervalCount: payload.recurringIntervalCount,
      isRecurring: payload.isRecurring,
      isArchived: payload.isArchived,
      externalOrganizationId: payload.organizationId,
      visibility: payload.visibility,
      createdAt: payload.createdAt,
      updatedAt: payload.modifiedAt ?? undefined,
      metadata: payload.metadata,
      prices: payload.prices,
    });
  });
};

const updateProduct = (payload: ProductPayload) => {
  return Effect.gen(function* () {
    const db = yield* DB;

    const existingProduct = yield* db
      .select({ id: schema.product.id })
      .from(schema.product)
      .where(eq(schema.product.id, payload.id));

    if (existingProduct.length === 1) {
      yield* db
        .update(schema.product)
        .set({
          id: payload.id,
          name: payload.name,
          description: payload.description,
          trialInterval: payload.trialInterval,
          trialIntervalCount: payload.trialIntervalCount,
          recurringInterval: payload.recurringInterval,
          recurringIntervalCount: payload.recurringIntervalCount,
          isRecurring: payload.isRecurring,
          isArchived: payload.isArchived,
          externalOrganizationId: payload.organizationId,
          visibility: payload.visibility,
          createdAt: payload.createdAt,
          updatedAt: payload.modifiedAt ?? new Date(),
          metadata: payload.metadata,
          prices: payload.prices,
        })
        .where(eq(schema.product.id, payload.id));
    } else {
      yield* createProduct(payload);
    }
  }).pipe(
    Effect.tapError((error) =>
      Effect.sync(() => console.error("[updateProduct] failed", error))
    )
  );
};
