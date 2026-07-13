import { createHash, randomBytes } from "node:crypto";
import { currentDb, schema } from "@feeblo/db";
import { UserId } from "@feeblo/id";
import { eq } from "drizzle-orm";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

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
   * user). Existing global users matched by real email are left untouched so
   * an SSO token never expands a real account's scope.
   */
  restrictedToOrganizationId?: string | null;
}

const makeUserRepository = Effect.succeed({
  findByEmailHash: (email: string) =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      const rows = yield* db
        .select({ id: schema.userTable.id })
        .from(schema.userTable)
        .where(eq(schema.userTable.emailHash, hashEmail(email)))
        .limit(1);
      return rows[0] ? Option.some(rows[0]) : Option.none();
    }),

  upsertSsoUser: (args: UpsertSsoUserInput) =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      const emailHash = hashEmail(args.email);
      const normalizedEmail = args.email.toLowerCase().trim();

      // Prefer linking to an existing Better-Auth user by real email. A real
      // account is never re-scoped to an organization by an SSO token, so
      // `restrictedToOrganizationId` is intentionally not applied here.
      const existingByEmail = yield* db
        .select({ id: schema.userTable.id })
        .from(schema.userTable)
        .where(eq(schema.userTable.email, normalizedEmail))
        .limit(1)
        .pipe(Effect.map((rows) => rows[0]));

      if (existingByEmail) {
        const updatedAt = yield* DateTime.nowAsDate;
        const [updated = null] = yield* db
          .update(schema.userTable)
          .set({
            name: args.name,
            emailHash,
            jwtAutoLoginAt: updatedAt,
            updatedAt,
          })
          .where(eq(schema.userTable.id, existingByEmail.id))
          .returning();
        if (!updated) {
          return yield* Effect.die(
            new Error("SSO user update did not return a row")
          );
        }
        return updated;
      }

      // Otherwise look up an existing SSO user by email hash.
      const existingByHash = yield* db
        .select({ id: schema.userTable.id })
        .from(schema.userTable)
        .where(eq(schema.userTable.emailHash, emailHash))
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
          return yield* Effect.die(
            new Error("SSO user update did not return a row")
          );
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
        return yield* Effect.die(
          new Error("SSO user insert did not return a row")
        );
      }
      return created;
    }),
});

/**
 * @effect-expect-leaking Database
 */
export class UserRepository extends Context.Service<UserRepository>()(
  "UserRepository",
  {
    make: makeUserRepository,
  }
) {
  static readonly layer = Layer.effect(this, this.make);
}
