import { describe, expect, layer } from "@effect/vitest";
import { currentDb, Database, schema } from "@feeblo/db";
import { ContactId, UserId, WorkspaceId } from "@feeblo/id";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { CurrentSession, type Session } from "../session-middleware";
import { ParticipationPolicy } from "./policies";
import { PARTICIPATION_BANNED_REASON } from "./schema";

describe("ParticipationPolicy", () => {
  const TestLayer = ParticipationPolicy.layer.pipe(
    Layer.provideMerge(Database.PgliteDatabaseLive)
  );

  const makeFixture = Effect.fnUntraced(function* () {
    const db = yield* currentDb;
    const organizationId = yield* WorkspaceId.generate;
    const userId = yield* UserId.generate;
    const email = `banned-${userId.toLowerCase()}@example.com`;
    const now = yield* DateTime.nowAsDate;
    yield* db.insert(schema.organizationTable).values({
      id: organizationId,
      name: "Policy workspace",
      slug: organizationId,
      createdAt: now,
    });
    yield* db.insert(schema.userTable).values({
      id: userId,
      email,
      name: "Banned end user",
    });
    yield* db.insert(schema.userBanTable).values({
      createdAt: now,
      email,
      id: `ban_${userId}`,
      organizationId,
      reason: "Abuse report",
      updatedAt: now,
      userId,
    });
    return { email, organizationId, userId };
  });

  const endUserSession = (
    organizationId: string,
    userId: string,
    email: string
  ): Session => ({
    memberships: [],
    organizations: [{ id: organizationId }],
    session: { token: "test-token", userId },
    user: {
      email,
      id: userId,
      name: "Banned end user",
      restrictedToOrganizationId: organizationId,
    },
  });

  layer(TestLayer)("policy", (it) => {
    it.effect("denies a banned end user and states why", () =>
      Effect.gen(function* () {
        const policy = yield* ParticipationPolicy;
        const fixture = yield* makeFixture();

        const error = yield* Effect.flip(
          policy
            .canParticipate(fixture.organizationId)
            .pipe(
              Effect.provideService(
                CurrentSession,
                endUserSession(
                  fixture.organizationId,
                  fixture.userId,
                  fixture.email
                )
              )
            )
        );

        expect(error).toMatchObject({
          _tag: "PolicyDenied",
          reason: PARTICIPATION_BANNED_REASON,
        });
      })
    );

    it.effect("lets a member through even when a ban row names them", () =>
      Effect.gen(function* () {
        const policy = yield* ParticipationPolicy;
        const fixture = yield* makeFixture();

        yield* policy.canParticipate(fixture.organizationId).pipe(
          Effect.provideService(CurrentSession, {
            ...endUserSession(
              fixture.organizationId,
              fixture.userId,
              fixture.email
            ),
            memberships: [
              {
                membershipId: `member_${fixture.userId}`,
                organizationId: fixture.organizationId,
                role: "manager",
              },
            ],
          })
        );
      })
    );

    it.effect("lets a member's contact through an address-only ban", () =>
      Effect.gen(function* () {
        const policy = yield* ParticipationPolicy;
        const fixture = yield* makeFixture();
        const db = yield* currentDb;
        const now = yield* DateTime.nowAsDate;
        const userId = yield* UserId.generate;
        const contactId = yield* ContactId.generate;
        const email = `member-${userId.toLowerCase()}@example.com`;

        yield* db.insert(schema.userTable).values({
          email,
          id: userId,
          name: "Workspace member",
        });
        yield* db.insert(schema.memberTable).values({
          createdAt: now,
          id: `member_${userId}`,
          organizationId: fixture.organizationId,
          role: "manager",
          userId,
        });
        yield* db.insert(schema.contactTable).values({
          createdAt: now,
          email,
          id: contactId,
          name: "Workspace member",
          organizationId: fixture.organizationId,
          updatedAt: now,
          userId,
        });
        // An address-only row that predates the membership must not deny the
        // member's widget SSO feedback.
        yield* db.insert(schema.userBanTable).values({
          createdAt: now,
          email,
          id: `ban_member_${userId}`,
          organizationId: fixture.organizationId,
          reason: null,
          updatedAt: now,
          userId: null,
        });

        yield* policy.canSubjectParticipate({
          contactId,
          organizationId: fixture.organizationId,
        });
        yield* policy.canSubjectParticipate({
          email,
          organizationId: fixture.organizationId,
        });
      })
    );

    it.effect("checks the address for a widget contact", () =>
      Effect.gen(function* () {
        const policy = yield* ParticipationPolicy;
        const fixture = yield* makeFixture();

        const error = yield* Effect.flip(
          policy.canSubjectParticipate({
            email: fixture.email.toUpperCase(),
            organizationId: fixture.organizationId,
          })
        );
        expect(error._tag).toBe("PolicyDenied");

        yield* policy.canSubjectParticipate({
          email: "someone-else@example.com",
          organizationId: fixture.organizationId,
        });
      })
    );
  });
});
