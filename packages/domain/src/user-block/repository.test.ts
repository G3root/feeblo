import { describe, expect, layer } from "@effect/vitest";
import { currentDb, Database, schema } from "@feeblo/db";
import { ContactId, UserId, WorkspaceId, asLegid } from "@feeblo/id";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { UserBlockRepository } from "./repository";

describe("UserBlockRepository", () => {
  const TestLayer = UserBlockRepository.layer.pipe(
    Layer.provideMerge(Database.PgliteDatabaseLive)
  );

  const createOrganization = Effect.fnUntraced(function* () {
    const db = yield* currentDb;
    const organizationId = yield* WorkspaceId.generate;
    const now = yield* DateTime.nowAsDate;
    yield* db.insert(schema.organizationTable).values({
      id: organizationId,
      name: "Block workspace",
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
        const repository = yield* UserBlockRepository;
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
          yield* repository.isBlocked({ organizationId, userId: account.id })
        ).toBe(true);
        expect(
          yield* repository.isBlocked({
            email: account.email.toUpperCase(),
            organizationId,
          })
        ).toBe(true);
        expect(
          yield* repository.isBlocked({
            organizationId: otherOrganizationId,
            userId: account.id,
          })
        ).toBe(false);
        expect(
          yield* repository.isBlocked({
            organizationId,
            userId: "someone_else",
          })
        ).toBe(false);
      })
    );

    it.effect("merges an address block with the account it later matches", () =>
      Effect.gen(function* () {
        const repository = yield* UserBlockRepository;
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
          yield* repository.isBlocked({
            email: account.email,
            organizationId,
            userId: account.id,
          })
        ).toBe(true);
      })
    );

    it.effect("resolves a contact and rejects a member target", () =>
      Effect.gen(function* () {
        const repository = yield* UserBlockRepository;
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

    it.effect("removes a block only inside its workspace", () =>
      Effect.gen(function* () {
        const repository = yield* UserBlockRepository;
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
          yield* repository.isBlocked({ organizationId, userId: account.id })
        ).toBe(false);
      })
    );
  });
});
