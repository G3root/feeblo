import { createHash, randomBytes } from "node:crypto";
import { currentDb, schema } from "@feeblo/db";
import { UserId } from "@feeblo/id";
import { and, eq } from "drizzle-orm";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { UserPersistenceError } from "./errors";

function hashEmail(email: string): string {
  return createHash("sha256").update(email.toLowerCase().trim()).digest("hex");
}

function generateRandomEmail(): string {
  const suffix = randomBytes(8).toString("hex");
  return `sso-${suffix}@feeblo.com`;
}

interface UpsertSsoUserInput {
  email: string;
  name: string;
  /**
   * When set, the SSO user is scoped to a single organization (widget portal
   * user). An SSO token never returns an existing globally-registered account,
   * so it cannot be used to take over a real user's session, and an SSO user
   * created for one organization is never re-scoped to another.
   */
  restrictedToOrganizationId?: string | null;
}

const makeUserRepository = Effect.gen(function* () {
  const db = yield* currentDb;

  return {
    findByEmailHash: (email: string) =>
      Effect.gen(function* () {
        const rows = yield* db
          .select({ id: schema.userTable.id })
          .from(schema.userTable)
          .where(eq(schema.userTable.emailHash, hashEmail(email)))
          .limit(1);
        return rows[0] ? Option.some(rows[0]) : Option.none();
      }),

    upsertSsoUser: (args: UpsertSsoUserInput) =>
      Effect.gen(function* () {
        const emailHash = hashEmail(args.email);

        // Match an existing SSO-only user by its email hash and organization.
        // Global Better Auth users may carry an email hash from earlier SSO
        // logins, so an unscoped user must never be matched here.
        const existingByHash = yield* db
          .select({ id: schema.userTable.id })
          .from(schema.userTable)
          .where(
            and(
              eq(schema.userTable.emailHash, emailHash),
              args.restrictedToOrganizationId != null
                ? eq(
                    schema.userTable.restrictedToOrganizationId,
                    args.restrictedToOrganizationId
                  )
                : undefined
            )
          )
          .limit(1)
          .pipe(Effect.map((rows) => rows[0]));

        if (existingByHash) {
          const updatedAt = yield* DateTime.nowAsDate;
          const [updated = null] = yield* db
            .update(schema.userTable)
            .set({
              name: args.name,
              ...(args.restrictedToOrganizationId !== undefined && {
                restrictedToOrganizationId: args.restrictedToOrganizationId,
              }),
              jwtAutoLoginAt: updatedAt,
              updatedAt,
            })
            .where(eq(schema.userTable.id, existingByHash.id))
            .returning();
          if (!updated) {
            return yield* new UserPersistenceError({
              message: "SSO user update did not return a row",
            });
          }
          return updated;
        }

        // Create a new SSO-only user with a random email address.
        const id = yield* UserId.generate;
        const now = yield* DateTime.nowAsDate;
        const [created = null] = yield* db
          .insert(schema.userTable)
          .values({
            id,
            name: args.name,
            email: generateRandomEmail(),
            emailVerified: true,
            emailHash,
            jwtAutoLoginAt: now,
            restrictedToOrganizationId: args.restrictedToOrganizationId ?? null,
            createdAt: now,
            updatedAt: now,
          })
          .returning();
        if (!created) {
          return yield* new UserPersistenceError({
            message: "SSO user insert did not return a row",
          });
        }
        return created;
      }),
  };
});

export class UserRepository extends Context.Service<UserRepository>()(
  "UserRepository",
  {
    make: makeUserRepository,
  }
) {
  static readonly layer = Layer.effect(this, this.make);
}
