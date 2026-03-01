import { SqlClient } from "@effect/sql";
import { DB } from "@feeblo/db";
import * as schema from "@feeblo/db/schema/index";
import { generateId } from "@feeblo/utils/id";
import { slugify } from "@feeblo/utils/url";
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
import { Config, Effect } from "effect";

export const initAuthHandler = () =>
  Effect.gen(function* () {
    const appUrl = yield* Config.string("VITE_APP_URL");
    const apiUrl = yield* Config.string("VITE_API_URL");
    const secret = yield* Config.string("AUTH_ENCRYPTION_KEY");
    const db = yield* DB;
    const sql = yield* SqlClient.SqlClient;

    const config = {
      database: drizzleAdapter(db, {
        provider: "pg",

        schema,
      }),
      baseURL: appUrl,
      secret,
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
      databaseHooks: {
        user: {
          create: {
            after: async (user) => {
              await Effect.runPromise(
                sql.withTransaction(
                  Effect.gen(function* () {
                    const boards = ["🐞 Bugs", "💡 Features"];

                    const [newOrg] = yield* db
                      .insert(schema.organization)
                      .values({
                        id: user.id,
                        name: "Personal",
                        slug: user.id,
                        logo: null,
                        createdAt: new Date(),
                      })
                      .returning({ id: schema.organization.id });

                    if (!newOrg) {
                      return yield* Effect.fail(
                        new Error("Failed to create organization")
                      );
                    }

                    yield* db.insert(schema.member).values({
                      id: generateId("member"),
                      organizationId: newOrg.id,
                      role: "owner",
                      createdAt: new Date(),
                      userId: user.id,
                    });

                    for (const board of boards) {
                      yield* db.insert(schema.board).values({
                        id: generateId("board"),
                        name: board,
                        createdAt: new Date(),
                        organizationId: newOrg.id,
                        slug: slugify(board),
                        visibility: "PUBLIC",
                      });
                    }
                  })
                )
              );
            },
          },
        },
      },
    } satisfies BetterAuthOptions;
    return betterAuth(config);
  });

export type Auth = Effect.Effect.Success<ReturnType<typeof initAuthHandler>>;
export type Session = Auth["$Infer"]["Session"];

export const auth = initAuthHandler();
