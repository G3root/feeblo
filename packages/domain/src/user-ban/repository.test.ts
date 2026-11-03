import { describe, expect, layer } from "@effect/vitest";
import { currentDb, Database, schema } from "@feeblo/db";
import { ContactId, UserId, WorkspaceId, asLegid } from "@feeblo/id";
import { eq } from "drizzle-orm";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { UserBanRepository } from "./repository";

describe("UserBanRepository", () => {
  const TestLayer = UserBanRepository.layer.pipe(
    Layer.provideMerge(Database.PgliteDatabaseLive)
  );

  const createOrganization = Effect.fnUntraced(function* () {
    const db = yield* currentDb;
    const organizationId = yield* WorkspaceId.generate;
    const now = yield* DateTime.nowAsDate;
    yield* db.insert(schema.organizationTable).values({
      id: organizationId,
      name: "Ban workspace",
      slug: organizationId,
      createdAt: now,
    });
    return organizationId;
  });

  const createUser = (suffix: string) =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      const id = yield* UserId.generate;
      const email = `${suffix}@example.com`;
      yield* db.insert(schema.userTable).values({
        id,
        email,
        name: `User ${suffix}`,
      });
      return { email, id };
    });

  const createContact = (input: {
    email: string | null;
    organizationId: string;
    userId: string | null;
  }) =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      const id = yield* ContactId.generate;
      const now = yield* DateTime.nowAsDate;
      yield* db.insert(schema.contactTable).values({
        id,
        createdAt: now,
        email: input.email,
        name: "Customer",
        organizationId: input.organizationId,
        updatedAt: now,
        userId: input.userId,
      });
      return id;
    });

  layer(TestLayer)("repository", (it) => {
    it.effect("matches an account and an address in one workspace only", () =>
      Effect.gen(function* () {
        const repository = yield* UserBanRepository;
        const organizationId = yield* createOrganization();
        const otherOrganizationId = yield* createOrganization();
        const account = yield* createUser("account");
        const now = yield* DateTime.nowAsDate;

        yield* repository.upsert({
          createdByMemberId: null,
          email: account.email,
          now,
          organizationId,
          reason: "spam",
          userId: account.id,
        });

        expect(
          yield* repository.isBanned({ organizationId, userId: account.id })
        ).toBe(true);
        expect(
          yield* repository.isBanned({
            email: account.email.toUpperCase(),
            organizationId,
          })
        ).toBe(true);
        expect(
          yield* repository.isBanned({
            organizationId: otherOrganizationId,
            userId: account.id,
          })
        ).toBe(false);
        expect(
          yield* repository.isBanned({
            organizationId,
            userId: "someone_else",
          })
        ).toBe(false);
      })
    );

    it.effect("keeps the address a merging ban names", () =>
      Effect.gen(function* () {
        const repository = yield* UserBanRepository;
        const organizationId = yield* createOrganization();
        const account = yield* createUser("facet");
        // The contact is how the same person is named with a second address.
        const contactEmail = "facet-contact@example.com";
        yield* createContact({
          email: contactEmail,
          organizationId,
          userId: account.id,
        });
        const now = yield* DateTime.nowAsDate;
        // The account row is created first so it is the survivor of the merge
        // below; ids are generated, so the ordering has to come from the date.
        const earlier = DateTime.toDateUtc(
          DateTime.makeUnsafe(now.getTime() - 60_000)
        );

        // Two rows for one person: the account, and the address the widget
        // uses. The third ban names both facets at once, so one row has to
        // carry the contact's address after the merge.
        yield* repository.upsert({
          createdByMemberId: null,
          email: account.email,
          now: earlier,
          organizationId,
          reason: null,
          userId: account.id,
        });
        yield* repository.upsert({
          createdByMemberId: null,
          email: contactEmail,
          now,
          organizationId,
          reason: null,
          userId: null,
        });
        yield* repository.upsert({
          createdByMemberId: null,
          email: contactEmail,
          now,
          organizationId,
          reason: null,
          userId: account.id,
        });

        const listed = yield* repository.list({
          limit: 10,
          offset: 0,
          organizationId,
        });
        expect(listed.total).toBe(1);

        // The identity the operator just banned is still banned, with no
        // account needed to match it, and so is the account.
        expect(
          yield* repository.isBanned({ email: contactEmail, organizationId })
        ).toBe(true);
        expect(
          yield* repository.isBanned({
            organizationId,
            userId: account.id,
          })
        ).toBe(true);
      })
    );

    it.effect("merges an address ban with the account it later matches", () =>
      Effect.gen(function* () {
        const repository = yield* UserBanRepository;
        const organizationId = yield* createOrganization();
        const account = yield* createUser("merge");
        const now = yield* DateTime.nowAsDate;

        yield* repository.upsert({
          createdByMemberId: null,
          email: account.email,
          now,
          organizationId,
          reason: null,
          userId: null,
        });
        yield* repository.upsert({
          createdByMemberId: null,
          email: account.email,
          now,
          organizationId,
          reason: "repeat",
          userId: account.id,
        });

        const listed = yield* repository.list({
          limit: 10,
          offset: 0,
          organizationId,
        });
        expect(listed.total).toBe(1);
        expect(listed.items[0]).toMatchObject({
          email: account.email,
          userId: account.id,
        });
        expect(
          yield* repository.isBanned({
            email: account.email,
            organizationId,
            userId: account.id,
          })
        ).toBe(true);
      })
    );

    it.effect("resolves a contact and rejects a member target", () =>
      Effect.gen(function* () {
        const repository = yield* UserBanRepository;
        const organizationId = yield* createOrganization();
        const account = yield* createUser("contact");
        const contactId = yield* createContact({
          email: account.email,
          organizationId,
          userId: account.id,
        });
        const member = yield* createUser("member");
        const now = yield* DateTime.nowAsDate;
        const db = yield* currentDb;
        yield* db.insert(schema.memberTable).values({
          id: `member_${member.id}`,
          createdAt: now,
          organizationId,
          role: "manager",
          userId: member.id,
        });

        const resolved = yield* repository.resolveTarget({
          organizationId,
          target: { _tag: "contact", contactId },
        });
        expect(resolved).toMatchObject({
          email: account.email,
          status: "ok",
          userId: account.id,
        });

        const memberTarget = yield* repository.resolveTarget({
          organizationId,
          target: { _tag: "user", userId: member.id },
        });
        expect(memberTarget).toEqual({ status: "member" });

        const missing = yield* repository.resolveTarget({
          organizationId,
          target: { _tag: "user", userId: asLegid(UserId)("missing") },
        });
        expect(missing).toEqual({ status: "not_found" });
      })
    );

    it.effect("does not adopt an account with no workspace relationship", () =>
      Effect.gen(function* () {
        const repository = yield* UserBanRepository;
        const organizationId = yield* createOrganization();
        const otherOrganizationId = yield* createOrganization();
        const unrelated = yield* createUser("unrelated");
        const otherOrgUser = yield* createUser("other-org");
        const restrictedUser = yield* createUser("restricted");
        const db = yield* currentDb;
        const now = yield* DateTime.nowAsDate;

        yield* db
          .update(schema.userTable)
          .set({ restrictedToOrganizationId: otherOrganizationId })
          .where(eq(schema.userTable.id, otherOrgUser.id));
        yield* db
          .update(schema.userTable)
          .set({ restrictedToOrganizationId: organizationId })
          .where(eq(schema.userTable.id, restrictedUser.id));

        expect(
          yield* repository.resolveTarget({
            organizationId,
            target: { _tag: "email", email: unrelated.email },
          })
        ).toEqual({
          email: unrelated.email,
          name: null,
          status: "ok",
          userId: null,
        });
        expect(
          yield* repository.resolveTarget({
            organizationId,
            target: { _tag: "user", userId: unrelated.id },
          })
        ).toEqual({ status: "not_found" });
        expect(
          yield* repository.resolveTarget({
            organizationId,
            target: { _tag: "user", userId: otherOrgUser.id },
          })
        ).toEqual({ status: "not_found" });
        expect(
          yield* repository.resolveTarget({
            organizationId,
            target: { _tag: "user", userId: restrictedUser.id },
          })
        ).toMatchObject({ status: "ok", userId: restrictedUser.id });

        // A contact with the address but no linked account keeps the address
        // target address-scoped; it does not make the unrelated account
        // addressable. Linking the contact to the account is what creates the
        // user-id relationship.
        const contactId = yield* createContact({
          email: unrelated.email,
          organizationId,
          userId: null,
        });
        expect(
          yield* repository.resolveTarget({
            organizationId,
            target: { _tag: "email", email: unrelated.email },
          })
        ).toEqual({
          email: unrelated.email,
          name: "Customer",
          status: "ok",
          userId: null,
        });
        expect(
          yield* repository.resolveTarget({
            organizationId,
            target: { _tag: "user", userId: unrelated.id },
          })
        ).toEqual({ status: "not_found" });

        yield* db
          .update(schema.contactTable)
          .set({ updatedAt: now, userId: unrelated.id })
          .where(eq(schema.contactTable.id, contactId));
        expect(
          yield* repository.resolveTarget({
            organizationId,
            target: { _tag: "user", userId: unrelated.id },
          })
        ).toMatchObject({
          email: unrelated.email,
          name: "Customer",
          status: "ok",
          userId: unrelated.id,
        });
      })
    );

    it.effect(
      "rejects an unlinked contact whose address belongs to a member",
      () =>
        Effect.gen(function* () {
          const repository = yield* UserBanRepository;
          const organizationId = yield* createOrganization();
          const member = yield* createUser("unlinked-member");
          const db = yield* currentDb;
          const now = yield* DateTime.nowAsDate;

          yield* db.insert(schema.memberTable).values({
            createdAt: now,
            id: `member_${member.id}`,
            organizationId,
            role: "manager",
            userId: member.id,
          });
          yield* createContact({
            email: member.email,
            organizationId,
            userId: null,
          });

          expect(
            yield* repository.resolveTarget({
              organizationId,
              target: { _tag: "email", email: member.email },
            })
          ).toEqual({ status: "member" });
        })
    );

    it.effect("prefers a linked contact over a case-variant unlinked row", () =>
      Effect.gen(function* () {
        const repository = yield* UserBanRepository;
        const organizationId = yield* createOrganization();
        const account = yield* createUser("case-linked");

        yield* createContact({
          email: "Case@example.com",
          organizationId,
          userId: null,
        });
        yield* createContact({
          email: "case@example.com",
          organizationId,
          userId: account.id,
        });

        expect(
          yield* repository.resolveTarget({
            organizationId,
            target: { _tag: "email", email: "CASE@example.com" },
          })
        ).toMatchObject({
          email: "case@example.com",
          status: "ok",
          userId: account.id,
        });
      })
    );

    it.effect(
      "does not lift another account's ban on a linked contact's address",
      () =>
        Effect.gen(function* () {
          const repository = yield* UserBanRepository;
          const organizationId = yield* createOrganization();
          const account = yield* createUser("facet-owner");
          const other = yield* createUser("facet-other");
          const contactEmail = "facet-shared-contact@example.com";
          yield* createContact({
            email: contactEmail,
            organizationId,
            userId: account.id,
          });
          const now = yield* DateTime.nowAsDate;

          yield* repository.upsert({
            createdByMemberId: null,
            email: account.email,
            now,
            organizationId,
            reason: null,
            userId: account.id,
          });
          // This row names the same address as the author's linked contact,
          // but belongs to another account; unlinking the contact below must
          // not lift it.
          yield* repository.upsert({
            createdByMemberId: null,
            email: contactEmail,
            now,
            organizationId,
            reason: null,
            userId: other.id,
          });

          yield* repository.removeByFacets({
            email: account.email,
            organizationId,
            userId: account.id,
          });

          expect(
            yield* repository.isBanned({ organizationId, userId: account.id })
          ).toBe(false);
          expect(
            yield* repository.isBanned({ organizationId, userId: other.id })
          ).toBe(true);
        })
    );

    it.effect("removes a ban only inside its workspace", () =>
      Effect.gen(function* () {
        const repository = yield* UserBanRepository;
        const organizationId = yield* createOrganization();
        const otherOrganizationId = yield* createOrganization();
        const account = yield* createUser("remove");
        const now = yield* DateTime.nowAsDate;

        yield* repository.upsert({
          createdByMemberId: null,
          email: account.email,
          now,
          organizationId,
          reason: null,
          userId: account.id,
        });
        const [row] = (yield* repository.list({
          limit: 10,
          offset: 0,
          organizationId,
        })).items;

        expect(
          yield* repository.remove({
            id: row?.id ?? "",
            organizationId: otherOrganizationId,
          })
        ).toEqual({ removed: false });
        expect(
          yield* repository.remove({
            id: row?.id ?? "",
            organizationId,
          })
        ).toEqual({ removed: true });
        expect(
          yield* repository.isBanned({ organizationId, userId: account.id })
        ).toBe(false);
      })
    );
  });
});
