import { createHash } from "node:crypto";

import { NodeCrypto } from "@effect/platform-node";
import { describe, expect, layer } from "@effect/vitest";
import { currentDb, Database, schema } from "@feeblo/db";
import {
  BoardId,
  ContactId,
  PostId,
  PostStatusId,
  WorkspaceId,
} from "@feeblo/id";
import { eq } from "drizzle-orm";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { ContactRepository } from "./repository";

const dateAt = (instant: string): Date =>
  DateTime.toDateUtc(DateTime.makeUnsafe(instant));

describe("ContactRepository", () => {
  const TestLayer = ContactRepository.layer.pipe(
    Layer.provideMerge(Database.PgliteDatabaseLive),
    Layer.provideMerge(NodeCrypto.layer)
  );

  const hashEmail = (email: string): string =>
    createHash("sha256").update(email.toLowerCase().trim()).digest("hex");

  const shadowInbox = (seed: string): string =>
    `behalf-${createHash("sha256").update(seed).digest("hex").slice(0, 16)}@feeblo.com`;

  const createOrganization = (id: string) =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      yield* db.insert(schema.organizationTable).values({
        id,
        name: "Contact upsert test workspace",
        slug: id,
        createdAt: yield* DateTime.nowAsDate,
      });
    });

  const createPostForContact = (args: {
    authorName: string;
    boardId: string;
    contactId: string;
    creatorId?: string;
    organizationId: string;
    postId: string;
    statusId: string;
  }) =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      yield* db.insert(schema.boardTable).values({
        id: args.boardId,
        name: "Board",
        slug: args.boardId,
        visibility: "PUBLIC",
        organizationId: args.organizationId,
        createdAt: yield* DateTime.nowAsDate,
        updatedAt: yield* DateTime.nowAsDate,
      });
      yield* db.insert(schema.postStatusTable).values({
        id: args.statusId,
        type: "PENDING",
        orderIndex: 0,
        organizationId: args.organizationId,
      });
      yield* db.insert(schema.postTable).values({
        id: args.postId,
        title: "Contact-anchored",
        slug: `contact-anchored-${args.postId}`,
        content: "Body",
        excerpt: "Body",
        boardId: args.boardId,
        statusId: args.statusId,
        organizationId: args.organizationId,
        contactId: args.contactId,
        ...(args.creatorId !== undefined && { creatorId: args.creatorId }),
        authorName: args.authorName,
        source: "DASHBOARD",
        metadata: {},
        createdAt: dateAt("2020-01-01T00:00:00.000Z"),
        updatedAt: dateAt("2020-01-01T00:00:00.000Z"),
      });
    });

  layer(TestLayer)("updateUpsertContact", (it) => {
    it.effect(
      "refuses an email another contact holds when the matched row has none",
      () =>
        Effect.gen(function* () {
          const db = yield* currentDb;
          const repository = yield* ContactRepository;
          const organizationId = yield* WorkspaceId.generate;
          const now = yield* DateTime.nowAsDate;

          yield* createOrganization(organizationId);

          // The row the external id matches carries no email yet, so the
          // email is not one the update would leave alone — it would write a
          // value another row holds.
          const ssoContactId = yield* ContactId.generate;
          yield* db.insert(schema.contactTable).values({
            id: ssoContactId,
            organizationId,
            externalId: "sso-1",
            name: "Ada",
            createdAt: now,
            updatedAt: now,
          });
          const emailHolderId = yield* ContactId.generate;
          yield* db.insert(schema.contactTable).values({
            id: emailHolderId,
            organizationId,
            email: "ada@example.com",
            name: "Ada (another record)",
            createdAt: now,
            updatedAt: now,
          });

          const existingContact = yield* repository.findUpsertContact({
            organizationId,
            externalId: "sso-1",
            email: "ada@example.com",
          });
          if (Option.isNone(existingContact)) {
            return yield* Effect.die(
              new Error("the external id must match the SSO contact")
            );
          }

          const error = yield* Effect.flip(
            repository.updateUpsertContact({
              organizationId,
              externalId: "sso-1",
              email: "ada@example.com",
              existing: existingContact.value,
            })
          );
          expect(error._tag).toBe("FailedToUpdateContactError");

          // Neither row was rewritten.
          const holder = yield* db
            .select()
            .from(schema.contactTable)
            .where(eq(schema.contactTable.id, emailHolderId));
          expect(holder[0]?.email).toBe("ada@example.com");
          const matched = yield* db
            .select()
            .from(schema.contactTable)
            .where(eq(schema.contactTable.id, ssoContactId));
          expect(matched[0]?.email).toBeNull();
        })
    );

    it.effect(
      "refreshes a post's author fallback when the upsert renames its contact",
      () =>
        Effect.gen(function* () {
          const db = yield* currentDb;
          const repository = yield* ContactRepository;
          const organizationId = yield* WorkspaceId.generate;
          const now = yield* DateTime.nowAsDate;
          const contactId = yield* ContactId.generate;
          const postId = yield* PostId.generate;
          const boardId = yield* BoardId.generate;
          const statusId = yield* PostStatusId.generate;

          yield* createOrganization(organizationId);
          yield* db.insert(schema.contactTable).values({
            id: contactId,
            organizationId,
            externalId: "sso-rename",
            name: "Before Rename",
            email: "before@example.com",
            createdAt: now,
            updatedAt: now,
          });
          yield* createPostForContact({
            authorName: "Before Rename",
            boardId,
            contactId,
            organizationId,
            postId,
            statusId,
          });

          const existingContact = yield* repository.findUpsertContact({
            organizationId,
            externalId: "sso-rename",
          });
          if (Option.isNone(existingContact)) {
            return yield* Effect.die(
              new Error("the external id must match the SSO contact")
            );
          }

          yield* repository.updateUpsertContact({
            organizationId,
            externalId: "sso-rename",
            name: "After Rename",
            existing: existingContact.value,
          });

          const [post] = yield* db
            .select({
              authorName: schema.postTable.authorName,
              updatedAt: schema.postTable.updatedAt,
            })
            .from(schema.postTable)
            .where(eq(schema.postTable.id, postId));
          expect(post?.authorName).toBe("After Rename");
          // The fallback is metadata about the post, not a post edit.
          expect(post?.updatedAt).toEqual(dateAt("2020-01-01T00:00:00.000Z"));
        })
    );

    it.effect(
      "leaves a post untouched when the upsert changes no identity field",
      () =>
        Effect.gen(function* () {
          const db = yield* currentDb;
          const repository = yield* ContactRepository;
          const organizationId = yield* WorkspaceId.generate;
          const now = yield* DateTime.nowAsDate;
          const contactId = yield* ContactId.generate;
          const postId = yield* PostId.generate;
          const boardId = yield* BoardId.generate;
          const statusId = yield* PostStatusId.generate;

          yield* createOrganization(organizationId);
          yield* db.insert(schema.contactTable).values({
            id: contactId,
            organizationId,
            externalId: "sso-phone",
            name: "Ada",
            email: "ada@example.com",
            createdAt: now,
            updatedAt: now,
          });
          yield* createPostForContact({
            authorName: "Deliberately stale",
            boardId,
            contactId,
            organizationId,
            postId,
            statusId,
          });

          const existingContact = yield* repository.findUpsertContact({
            organizationId,
            externalId: "sso-phone",
          });
          if (Option.isNone(existingContact)) {
            return yield* Effect.die(
              new Error("the external id must match the SSO contact")
            );
          }

          yield* repository.updateUpsertContact({
            organizationId,
            externalId: "sso-phone",
            name: "Ada",
            email: "ada@example.com",
            phone: "+44 20 0000 0000",
            existing: existingContact.value,
          });

          const [post] = yield* db
            .select({
              authorName: schema.postTable.authorName,
              updatedAt: schema.postTable.updatedAt,
            })
            .from(schema.postTable)
            .where(eq(schema.postTable.id, postId));
          expect(post?.authorName).toBe("Deliberately stale");
          expect(post?.updatedAt).toEqual(dateAt("2020-01-01T00:00:00.000Z"));
        })
    );
  });

  layer(TestLayer)("update", (it) => {
    it.effect(
      "moves a linked shadow's email hash with a corrected contact address",
      () =>
        Effect.gen(function* () {
          const db = yield* currentDb;
          const repository = yield* ContactRepository;
          const organizationId = yield* WorkspaceId.generate;
          const now = yield* DateTime.nowAsDate;
          const contactId = yield* ContactId.generate;
          const postId = yield* PostId.generate;
          const boardId = yield* BoardId.generate;
          const statusId = yield* PostStatusId.generate;
          const oldEmail = "old@example.com";
          const newEmail = "new@example.com";
          const shadowUserId = `shadow_${contactId}`;
          const shadowEmail = shadowInbox(contactId);
          const oldUpdatedAt = dateAt("2020-01-01T00:00:00.000Z");

          yield* createOrganization(organizationId);
          yield* db.insert(schema.userTable).values({
            id: shadowUserId,
            name: "Ada",
            email: shadowEmail,
            emailHash: hashEmail(oldEmail),
            emailVerified: false,
            restrictedToOrganizationId: organizationId,
            createdAt: oldUpdatedAt,
            updatedAt: oldUpdatedAt,
          });
          yield* db.insert(schema.contactTable).values({
            id: contactId,
            organizationId,
            email: oldEmail,
            name: null,
            userId: shadowUserId,
            createdAt: now,
            updatedAt: now,
          });
          yield* createPostForContact({
            authorName: oldEmail,
            boardId,
            contactId,
            organizationId,
            postId,
            statusId,
          });

          const updated = yield* repository.update({
            id: contactId,
            organizationId,
            email: newEmail,
          });
          expect(Option.isSome(updated)).toBe(true);

          const [user] = yield* db
            .select()
            .from(schema.userTable)
            .where(eq(schema.userTable.id, shadowUserId));
          expect(user?.emailHash).toBe(hashEmail(newEmail));
          // The synthetic inbox is what keeps a shadow unauthenticatable.
          expect(user?.email).toMatch(/^behalf-.*@feeblo\.com$/);
          expect(user?.updatedAt).not.toEqual(oldUpdatedAt);

          const [post] = yield* db
            .select({
              authorName: schema.postTable.authorName,
              updatedAt: schema.postTable.updatedAt,
            })
            .from(schema.postTable)
            .where(eq(schema.postTable.id, postId));
          expect(post?.authorName).toBe(newEmail);
          expect(post?.updatedAt).toEqual(dateAt("2020-01-01T00:00:00.000Z"));
        })
    );

    it.effect(
      "heals into an existing identity instead of colliding with its hash",
      () =>
        Effect.gen(function* () {
          const db = yield* currentDb;
          const repository = yield* ContactRepository;
          const organizationId = yield* WorkspaceId.generate;
          const now = yield* DateTime.nowAsDate;
          const contactId = yield* ContactId.generate;
          const postId = yield* PostId.generate;
          const boardId = yield* BoardId.generate;
          const statusId = yield* PostStatusId.generate;
          const oldEmail = "before-correction@example.com";
          const targetEmail = "existing-identity@example.com";
          const shadowUserId = `shadow_${contactId}`;
          const existingShadowUserId = `shadow_existing_${contactId}`;

          yield* createOrganization(organizationId);
          // The address being corrected to still has an org-scoped identity:
          // its customer was deleted, but a vote kept the shadow alive.
          yield* db.insert(schema.userTable).values([
            {
              id: shadowUserId,
              name: "Ada",
              email: shadowInbox(shadowUserId),
              emailHash: hashEmail(oldEmail),
              emailVerified: false,
              restrictedToOrganizationId: organizationId,
              createdAt: now,
              updatedAt: now,
            },
            {
              id: existingShadowUserId,
              name: "Ada",
              email: shadowInbox(existingShadowUserId),
              emailHash: hashEmail(targetEmail),
              emailVerified: false,
              restrictedToOrganizationId: organizationId,
              createdAt: now,
              updatedAt: now,
            },
          ]);
          yield* db.insert(schema.contactTable).values({
            id: contactId,
            organizationId,
            email: oldEmail,
            userId: shadowUserId,
            createdAt: now,
            updatedAt: now,
          });
          yield* createPostForContact({
            authorName: "Ada",
            boardId,
            contactId,
            creatorId: shadowUserId,
            organizationId,
            postId,
            statusId,
          });

          const updated = yield* repository.update({
            id: contactId,
            organizationId,
            email: targetEmail,
          });
          expect(Option.isSome(updated)).toBe(true);

          // The correction commits by adopting the existing identity, not by
          // writing a duplicate hash the unique index would reject.
          const [contact] = yield* db
            .select()
            .from(schema.contactTable)
            .where(eq(schema.contactTable.id, contactId));
          expect(contact?.email).toBe(targetEmail);
          expect(contact?.userId).toBe(existingShadowUserId);

          const users = yield* db
            .select({ id: schema.userTable.id })
            .from(schema.userTable)
            .where(
              eq(schema.userTable.restrictedToOrganizationId, organizationId)
            );
          expect(users.map((user) => user.id)).toEqual([existingShadowUserId]);

          const [post] = yield* db
            .select({ creatorId: schema.postTable.creatorId })
            .from(schema.postTable)
            .where(eq(schema.postTable.id, postId));
          expect(post?.creatorId).toBe(existingShadowUserId);
        })
    );

    it.effect(
      "leaves a real account's email hash alone when its contact changes",
      () =>
        Effect.gen(function* () {
          const db = yield* currentDb;
          const repository = yield* ContactRepository;
          const organizationId = yield* WorkspaceId.generate;
          const now = yield* DateTime.nowAsDate;
          const contactId = yield* ContactId.generate;
          const userId = `real_${contactId}`;
          const oldEmail = "old-real@example.com";
          const oldUpdatedAt = dateAt("2020-01-01T00:00:00.000Z");

          yield* createOrganization(organizationId);
          yield* db.insert(schema.userTable).values({
            id: userId,
            name: "Ada",
            email: oldEmail,
            emailHash: hashEmail(oldEmail),
            emailVerified: true,
            createdAt: oldUpdatedAt,
            updatedAt: oldUpdatedAt,
          });
          yield* db.insert(schema.contactTable).values({
            id: contactId,
            organizationId,
            email: oldEmail,
            userId,
            createdAt: now,
            updatedAt: now,
          });

          yield* repository.update({
            id: contactId,
            organizationId,
            email: "new-real@example.com",
          });

          const [user] = yield* db
            .select()
            .from(schema.userTable)
            .where(eq(schema.userTable.id, userId));
          expect(user?.emailHash).toBe(hashEmail(oldEmail));
          expect(user?.updatedAt).toEqual(oldUpdatedAt);
        })
    );
  });
});
