import { currentDb, schema } from "@feeblo/db";
import { ContactId } from "@feeblo/id";
import { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { and, eq } from "drizzle-orm";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { UserRepository } from "../user/repository";
import { isSyntheticEmail } from "./emails";
import { InvalidSubjectError, SubjectNotFoundError } from "./errors";

// Re-exported so existing importers keep a single identity entrypoint; the
// predicates live in a dependency-free leaf module to avoid import cycles.
export { isSyntheticEmail };

/**
 * The customer an on-behalf action is attributed to. Identifiers are
 * consulted in strict priority order: `userId` > `contactId` >
 * `externalId` > `email`. Lower-priority fields only enrich the resolved
 * contact (empty name/avatar backfill); they never overwrite it.
 */
export interface OnBehalfSubject {
  userId?: string | undefined;
  contactId?: string | undefined;
  externalId?: string | undefined;
  email?: string | undefined;
  name?: string | undefined;
  avatarUrl?: string | undefined;
}

export interface ResolvePrincipalInput {
  organizationId: string;
  /**
   * Whether the action needs a user row (votes and comments do; posts do
   * not). When true and the contact has no linked account, a shadow user is
   * provisioned from the contact's email.
   */
  needsUser: boolean;
  subject: OnBehalfSubject;
}

export interface ResolvedPrincipal {
  contactId: string;
  /** The linked account: a real user, a provisioned shadow user, or null. */
  userId: string | null;
}

type Contact = typeof schema.contactTable.$inferSelect;
type ContactInsert = typeof schema.contactTable.$inferInsert;

const normalizeEmail = (email: string | undefined): string | undefined => {
  const trimmed = email?.toLowerCase().trim();
  return trimmed ? trimmed : undefined;
};

const makeResolvePrincipalService = Effect.gen(function* () {
  const db = yield* currentDb;
  const userRepository = yield* UserRepository;

  const getContactInOrganization = (id: string, organizationId: string) =>
    Effect.gen(function* () {
      const rows = yield* db
        .select()
        .from(schema.contactTable)
        .where(
          and(
            eq(schema.contactTable.id, id),
            eq(schema.contactTable.organizationId, organizationId)
          )
        )
        .limit(1);
      const contact = rows[0];
      if (!contact) {
        return yield* new SubjectNotFoundError({
          message: "No customer with this id exists in this workspace",
        });
      }
      return contact;
    });

  const findOneContact = (where: ReturnType<typeof and>) =>
    db
      .select()
      .from(schema.contactTable)
      .where(where)
      .limit(1)
      .pipe(
        Effect.map((rows) =>
          rows[0] ? Option.some(rows[0]) : Option.none()
        )
      );

  const findContactByUser = (organizationId: string, userId: string) =>
    findOneContact(
      and(
        eq(schema.contactTable.organizationId, organizationId),
        eq(schema.contactTable.userId, userId)
      )
    );

  const findContactByEmail = (organizationId: string, email: string) =>
    findOneContact(
      and(
        eq(schema.contactTable.organizationId, organizationId),
        eq(schema.contactTable.email, email)
      )
    );

  const findContactByExternalId = (
    organizationId: string,
    externalId: string
  ) =>
    findOneContact(
      and(
        eq(schema.contactTable.organizationId, organizationId),
        eq(schema.contactTable.externalId, externalId)
      )
    );

  /**
   * Backfills only empty identity fields on an existing contact. Subject
   * fields must never overwrite what is already known about a customer.
   */
  const enrichContact = (contact: Contact, subject: OnBehalfSubject) =>
    Effect.gen(function* () {
      const nextName = contact.name ?? subject.name ?? null;
      const nextAvatar = contact.avatar ?? subject.avatarUrl ?? null;

      if (nextName === contact.name && nextAvatar === contact.avatar) {
        return contact;
      }

      const now = yield* DateTime.nowAsDate;
      const [updated = null] = yield* db
        .update(schema.contactTable)
        .set({
          ...(nextName !== contact.name && { name: nextName }),
          ...(nextAvatar !== contact.avatar && { avatar: nextAvatar }),
          updatedAt: now,
        })
        .where(eq(schema.contactTable.id, contact.id))
        .returning();
      return updated ?? contact;
    });

  /**
   * Guarantees the contact carries a linked user when the action requires
   * one, provisioning a shadow user from the contact's email otherwise.
   */
  const ensureLinkedUser = (
    contact: Contact,
    args: {
      organizationId: string;
      needsUser: boolean;
      email: string | undefined;
    }
  ) =>
    Effect.gen(function* () {
      if (!args.needsUser) {
        return contact.userId;
      }
      if (contact.userId) {
        return contact.userId;
      }

      const shadowEmail = contact.email ?? args.email;
      if (!shadowEmail || isSyntheticEmail(shadowEmail)) {
        return yield* new InvalidSubjectError({
          message: "Cannot attribute to a customer without an email address",
        });
      }

      const shadow = yield* userRepository.provisionShadowUser({
        email: shadowEmail,
        name: contact.name ?? "Customer",
        restrictedToOrganizationId: args.organizationId,
      });

      const now = yield* DateTime.nowAsDate;
      const [updated = null] = yield* db
        .update(schema.contactTable)
        .set({ userId: shadow.id, updatedAt: now })
        .where(eq(schema.contactTable.id, contact.id))
        .returning();

      return updated?.userId ?? shadow.id;
    });

  /**
   * Insert that tolerates losing a race against the `(organization_id, email)`
   * or `(organization_id, external_id)` unique indexes by re-reading the
   * winner.
   */
  function insertContactToleratingRace(
    values: Omit<ContactInsert, "id" | "createdAt" | "updatedAt">,
    redetect: () => Effect.Effect<Option.Option<Contact>, EffectDrizzleQueryError>
  ) {
    return Effect.gen(function* () {
      const id = yield* ContactId.generate;
      const now = yield* DateTime.nowAsDate;
      const [created = null] = yield* db
        .insert(schema.contactTable)
        .values({ ...values, id, createdAt: now, updatedAt: now })
        .onConflictDoNothing()
        .returning();
      if (created) {
        return created;
      }
      // Lost an insert race; the winner must exist by now.
      const winner = yield* redetect();
      if (Option.isSome(winner)) {
        return winner.value;
      }
      return yield* Effect.die(
        new Error("Contact insert conflicted but no winner was found")
      );
    });
  }

  return {
    resolve: ({
      organizationId,
      needsUser,
      subject,
    }: ResolvePrincipalInput) =>
      Effect.gen(function* () {
        const email = normalizeEmail(subject.email);

        // -- Priority 1: explicit feeblo user id ---------------------------
        if (subject.userId) {
          const user = yield* userRepository.getById(subject.userId);
          if (Option.isNone(user)) {
            return yield* new SubjectNotFoundError({
              message: "No user with this id exists",
            });
          }

          let contact = Option.getOrUndefined(
            yield* findContactByUser(organizationId, user.value.id)
          );
          if (!contact) {
            // Avoid tripping the `(organization_id, email)` unique index by
            // matching on a usable address before inserting. Synthetic
            // inboxes are excluded: they are never usable contact emails.
            const candidateEmail =
              email && !isSyntheticEmail(email)
                ? email
                : !isSyntheticEmail(user.value.email)
                  ? user.value.email
                  : undefined;
            const existingByEmail = candidateEmail
              ? Option.getOrUndefined(
                  yield* findContactByEmail(organizationId, candidateEmail)
                )
              : undefined;

            if (existingByEmail) {
              const now = yield* DateTime.nowAsDate;
              const [linked = null] = yield* db
                .update(schema.contactTable)
                .set({ userId: user.value.id, updatedAt: now })
                .where(eq(schema.contactTable.id, existingByEmail.id))
                .returning();
              contact = linked ?? existingByEmail;
            } else {
              contact = yield* insertContactToleratingRace(
                {
                  organizationId,
                  userId: user.value.id,
                  name: subject.name ?? user.value.name,
                  email: candidateEmail ?? null,
                  avatar: subject.avatarUrl ?? user.value.image ?? null,
                },
                () => findContactByUser(organizationId, user.value.id)
              );
            }
          }

          const enriched = yield* enrichContact(contact, subject);
          return {
            contactId: enriched.id,
            userId: enriched.userId ?? user.value.id,
          };
        }

        // -- Priority 2: explicit contact id -------------------------------
        if (subject.contactId) {
          const found = yield* getContactInOrganization(
            subject.contactId,
            organizationId
          );
          const contact = yield* enrichContact(found, subject);
          const userId = yield* ensureLinkedUser(contact, {
            organizationId,
            needsUser,
            email,
          });
          return { contactId: contact.id, userId };
        }

        // -- Priority 3: external id from the customer's system ------------
        if (subject.externalId) {
          const byExternalId = yield* findContactByExternalId(
            organizationId,
            subject.externalId
          );
          if (Option.isSome(byExternalId)) {
            const contact = yield* enrichContact(byExternalId.value, subject);
            const userId = yield* ensureLinkedUser(contact, {
              organizationId,
              needsUser,
              email,
            });
            return { contactId: contact.id, userId };
          }

          // No external-id match: fall through to an email match before
          // creating, so one human still ends up as one contact.
          const byEmail = email
            ? Option.getOrUndefined(
                yield* findContactByEmail(organizationId, email)
              )
            : undefined;
          if (byEmail) {
            const now = yield* DateTime.nowAsDate;
            const [claimed = null] = yield* db
              .update(schema.contactTable)
              .set({ externalId: subject.externalId, updatedAt: now })
              .where(eq(schema.contactTable.id, byEmail.id))
              .returning();
            const contact = yield* enrichContact(
              // SAFETY: `byEmail` is narrowed non-null within this branch and
              // the returning() fallback preserves the row type.
              claimed ?? byEmail,
              subject
            );
            const userId = yield* ensureLinkedUser(contact, {
              organizationId,
              needsUser,
              email,
            });
            return { contactId: contact.id, userId };
          }

          const created = yield* insertContactToleratingRace(
            {
              organizationId,
              externalId: subject.externalId,
              email: email ?? null,
              name: subject.name ?? null,
              avatar: subject.avatarUrl ?? null,
            },
            () => findContactByExternalId(organizationId, subject.externalId!)
          );
          const userId = yield* ensureLinkedUser(created, {
            organizationId,
            needsUser,
            email,
          });
          return { contactId: created.id, userId };
        }

        // -- Priority 4: email as the find-or-create key -------------------
        if (email) {
          const existing = yield* findContactByEmail(organizationId, email);
          if (Option.isSome(existing)) {
            const contact = yield* enrichContact(existing.value, subject);
            const userId = yield* ensureLinkedUser(contact, {
              organizationId,
              needsUser,
              email,
            });
            return { contactId: contact.id, userId };
          }

          // The email may belong to a real account that simply has no contact
          // in this workspace yet — adopt them instead of shadowing them.
          const adoptable = yield* userRepository.findAdoptableByIdentityHash({
            email,
            organizationId,
          });
          if (Option.isSome(adoptable)) {
            const user = adoptable.value;
            const linked = Option.getOrUndefined(
              yield* findContactByUser(organizationId, user.id)
            );
            if (linked) {
              const contact = yield* enrichContact(linked, subject);
              return {
                contactId: contact.id,
                userId: contact.userId ?? user.id,
              };
            }
            const created = yield* insertContactToleratingRace(
              {
                organizationId,
                userId: user.id,
                email,
                name: subject.name ?? user.name,
                avatar: subject.avatarUrl ?? user.image ?? null,
              },
              () => findContactByUser(organizationId, user.id)
            );
            return { contactId: created.id, userId: user.id };
          }

          // Nothing anywhere: create the customer, plus a shadow user when
          // the action needs one.
          const created = yield* insertContactToleratingRace(
            {
              organizationId,
              email,
              name: subject.name ?? null,
              avatar: subject.avatarUrl ?? null,
            },
            () => findContactByEmail(organizationId, email)
          );
          const userId = yield* ensureLinkedUser(created, {
            organizationId,
            needsUser,
            email,
          });
          return { contactId: created.id, userId };
        }

        return yield* new InvalidSubjectError({
          message:
            "Provide at least one subject identifier: userId, contactId, externalId, or email",
        });
      }),
  }
});

export class ResolvePrincipalService extends Context.Service<ResolvePrincipalService>()(
  "ResolvePrincipalService",
  {
    make: makeResolvePrincipalService,
  }
) {
  static readonly layer = Layer.effect(this, this.make).pipe(
    Layer.provide(UserRepository.layer)
  );
}
