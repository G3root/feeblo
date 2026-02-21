import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2";
import { DB } from "@feeblo/db";
import * as schema from "@feeblo/db/schema/index";
import { generateId } from "@feeblo/utils/id";
import { slugify } from "@feeblo/utils/url";
import { type BetterAuthOptions, betterAuth } from "better-auth";
import {
  admin,
  emailOTP,
  lastLoginMethod,
  organization,
} from "better-auth/plugins";
import { and, eq } from "drizzle-orm";
import { Config, Effect } from "effect";

export const initAuthHandler = () =>
  Effect.gen(function* () {
    const appUrl = yield* Config.string("VITE_APP_URL");
    const apiUrl = yield* Config.string("VITE_API_URL");
    const secret = yield* Config.string("AUTH_ENCRYPTION_KEY");
    const db = yield* DB;

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

      plugins: [
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
                db.transaction((tx) =>
                  Effect.gen(function* () {
                    const boards = ["🐞 Bugs", "💡 Features"];

                    const [newOrg] = yield* tx
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

                    yield* tx.insert(schema.member).values({
                      id: generateId("member"),
                      organizationId: newOrg.id,
                      role: "owner",
                      createdAt: new Date(),
                      userId: user.id,
                    });

                    for (const board of boards) {
                      yield* tx.insert(schema.board).values({
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
        session: {
          create: {
            before: async (session) => {
              const [organization] = await Effect.runPromise(
                db
                  .select({ id: schema.organization.id })
                  .from(schema.organization)
                  .where(eq(schema.organization.id, session.userId))
                  .limit(1)
              );

              if (!organization) {
                throw new Error("Organization not found for session user");
              }

              const [member] = await Effect.runPromise(
                db
                  .select({ id: schema.member.id })
                  .from(schema.member)
                  .where(
                    and(
                      eq(schema.member.organizationId, organization.id),
                      eq(schema.member.userId, session.userId)
                    )
                  )
                  .limit(1)
              );

              if (!member) {
                throw new Error("Member not found for session user");
              }

              return {
                data: {
                  ...session,
                  activeOrganizationId: organization.id,
                  activeMemberId: member.id,
                },
              };
            },
          },
        },
      },

      session: {
        additionalFields: {
          activeMemberId: {
            type: "string",
          },
          activeOrganizationId: {
            type: "string",
          },
        },
      },
      // user: {
      //   additionalFields: {
      //     isOnboarded: {
      //       type: "boolean",
      //     },
      //   },
      // },
    } satisfies BetterAuthOptions;
    return betterAuth(config);
  });

export type Auth = Effect.Effect.Success<ReturnType<typeof initAuthHandler>>;
export type Session = Auth["$Infer"]["Session"];

export const auth = initAuthHandler();
