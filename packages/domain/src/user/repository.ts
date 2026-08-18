import { createHash } from "node:crypto";

import { currentDb, schema } from "@feeblo/db";
import { UserId } from "@feeblo/id";
import { and, eq } from "drizzle-orm";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { UserPersistenceError } from "./errors";

function hashEmail(email: string): string {
  return createHash("sha256").update(email.toLowerCase().trim()).digest("hex");
}

const generateRandomEmail = () =>
  Effect.gen(function* () {
    const crypto = yield* Crypto.Crypto;
    const suffix = Buffer.from(yield* crypto.randomBytes(8)).toString("hex");
    return `sso-${suffix}@feeblo.com`;
  }).pipe(Effect.orDie);

interface UpsertSsoUserInput {
  email: string;
  name: string;
  /**
   * The SSO user is always scoped to a single organization (widget portal
   * user). The value is required: an SSO token never returns an existing
   * globally-registered account, so it cannot be used to take over a real
   * user's session, and an SSO user created for one organization is never
   * re-scoped to another.
   */
  restrictedToOrganizationId: string;
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

        // Explicit type guard: an SSO portal upsert must always be scoped to an
        // organization. Guard before the lookup so the query below can never
        // fall back to matching a globally-registered Better Auth user that
        // merely carries an email hash from an earlier SSO login.
        const restrictedToOrganizationId = args.restrictedToOrganizationId;
        if (restrictedToOrganizationId == null) {
          return yield* new UserPersistenceError({
            message: "SSO portal upsert requires a restrictedToOrganizationId",
          });
        }

        // Match an existing SSO-only user by its email hash and organization.
        const existingByHash = yield* db
          .select({ id: schema.userTable.id })
          .from(schema.userTable)
          .where(
            and(
              eq(schema.userTable.emailHash, emailHash),
              eq(
                schema.userTable.restrictedToOrganizationId,
                restrictedToOrganizationId
              )
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
              restrictedToOrganizationId,
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
            email: yield* generateRandomEmail(),
            emailVerified: true,
            emailHash,
            jwtAutoLoginAt: now,
            restrictedToOrganizationId,
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
