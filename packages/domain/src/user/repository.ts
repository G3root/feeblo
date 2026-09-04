import { createHash } from "node:crypto";

import { currentDb, schema } from "@feeblo/db";
import { UserId } from "@feeblo/id";
import { and, eq, sql } from "drizzle-orm";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { isShadowUserEmail } from "../identity/emails";
import { UserPersistenceError } from "./errors";

function hashEmail(email: string): string {
  return createHash("sha256").update(email.toLowerCase().trim()).digest("hex");
}

const generateRandomEmail = (prefix: string) =>
  Effect.gen(function* () {
    const crypto = yield* Crypto.Crypto;
    const suffix = Buffer.from(yield* crypto.randomBytes(8)).toString("hex");
    return `${prefix}-${suffix}@feeblo.com`;
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

interface ProvisionShadowUserInput {
  /**
   * The subject's real email. It is only hashed for matching; the stored
   * account email is always synthetic, so a shadow user can never collide
   * with — or be claimed by — a globally-registered account.
   */
  email: string;
  name: string;
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

    getById: (id: string) =>
      Effect.gen(function* () {
        const rows = yield* db
          .select()
          .from(schema.userTable)
          .where(eq(schema.userTable.id, id))
          .limit(1);
        return rows[0] ? Option.some(rows[0]) : Option.none();
      }),

    /**
     * Finds a user by verified identity hash that a workspace may attribute
     * content to: globally-registered accounts, or accounts restricted to
     * exactly this organization. Users restricted to other organizations are
     * deliberately invisible so one workspace cannot adopt another
     * workspace's portal identities.
     */
    findAdoptableByIdentityHash: (args: {
      email: string;
      organizationId: string;
    }) =>
      Effect.gen(function* () {
        const rows = yield* db
          .select()
          .from(schema.userTable)
          .where(
            and(
              eq(schema.userTable.emailHash, hashEmail(args.email)),
              sql`(${schema.userTable.restrictedToOrganizationId} IS NULL OR ${schema.userTable.restrictedToOrganizationId} = ${args.organizationId})`
            )
          )
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
          .select()
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
          // A `behalf-*` match means an on-behalf shadow user was provisioned
          // for this human before they ever used the widget portal. The SSO
          // sign-in heals the identity in place: the row keeps every attributed
          // contact/post/vote/comment/subscription (nothing to reassign — it
          // already is the session identity) but is promoted to a clean,
          // verified portal account with a fresh synthetic `sso-` inbox.
          const promotedFromShadow = isShadowUserEmail(existingByHash.email);
          const [updated = null] = yield* db
            .update(schema.userTable)
            .set({
              name: args.name,
              ...(promotedFromShadow && {
                email: yield* generateRandomEmail("sso"),
                emailVerified: true,
              }),
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
            email: yield* generateRandomEmail("sso"),
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

    /**
     * Finds or creates the attribution-only user backing an on-behalf
     * subject (see plan-on-behalf.md). Shadow users carry a synthetic
     * `behalf-*` email, are never email-verified, and have no credentials,
     * so they can never authenticate. Matching is scoped to one organization
     * by (email hash, organization) and may adopt an existing SSO portal
     * user for the same human — their identity is already proven by the
     * customer's identity provider, so their verification state is left
     * untouched.
     */
    provisionShadowUser: (args: ProvisionShadowUserInput) =>
      Effect.gen(function* () {
        const emailHash = hashEmail(args.email);
        const restrictedToOrganizationId = args.restrictedToOrganizationId;

        if (restrictedToOrganizationId == null) {
          return yield* new UserPersistenceError({
            message: "Shadow user provisioning requires a organization scope",
          });
        }

        // Match any org-restricted user for this human in this organization:
        // a previously provisioned shadow user or an SSO portal user.
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
            .set({ name: args.name, updatedAt })
            .where(eq(schema.userTable.id, existingByHash.id))
            .returning();
          if (!updated) {
            return yield* new UserPersistenceError({
              message: "Shadow user update did not return a row",
            });
          }
          return updated;
        }

        // Create a new shadow user with a random, never-mailable address.
        const id = yield* UserId.generate;
        const now = yield* DateTime.nowAsDate;
        const [created = null] = yield* db
          .insert(schema.userTable)
          .values({
            id,
            name: args.name,
            email: yield* generateRandomEmail("behalf"),
            emailVerified: false,
            emailHash,
            restrictedToOrganizationId,
            createdAt: now,
            updatedAt: now,
          })
          .returning();
        if (!created) {
          return yield* new UserPersistenceError({
            message: "Shadow user insert did not return a row",
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
