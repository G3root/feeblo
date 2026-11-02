import { describe, expect, layer } from "@effect/vitest";
import { currentDb, Database, schema } from "@feeblo/db";
import { UserBlockId, UserId, WorkspaceId, asLegid } from "@feeblo/id";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import {
  CurrentSession,
  OptionalCurrentSession,
  type Session,
} from "../session-middleware";
import { UserBlockRpcHandlers, UserBlockRpcHandlersEffect } from "./handlers";
import { UserBlockRepository } from "./repository";

describe("UserBlockRpcHandlers", () => {
  const TestLayer = Layer.mergeAll(
    Database.PgliteDatabaseLive,
    UserBlockRpcHandlers.pipe(Layer.provide(Database.PgliteDatabaseLive)),
    UserBlockRepository.layer.pipe(Layer.provide(Database.PgliteDatabaseLive))
  );

  type Fixture = {
    memberId: string;
    organizationId: string;
    role: "admin" | "contributor" | "manager";
    userId: string;
  };

  const makeFixture = (role: Fixture["role"] = "manager") =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      const organizationId = yield* WorkspaceId.generate;
      const userId = yield* UserId.generate;
      const memberId = `member_${userId}`;
      const now = yield* DateTime.nowAsDate;
      yield* db.insert(schema.organizationTable).values({
        id: organizationId,
        name: "Block workspace",
        slug: organizationId,
        createdAt: now,
      });
      yield* db.insert(schema.userTable).values({
        id: userId,
        email: `manager-${userId}@example.com`,
        name: "Manager",
      });
      yield* db.insert(schema.memberTable).values({
        id: memberId,
        createdAt: now,
        organizationId,
        role,
        userId,
      });
      return { memberId, organizationId, role, userId } satisfies Fixture;
    });

  const session = (fixture: Fixture): Session => ({
    user: {
      email: `manager-${fixture.userId}@example.com`,
      id: fixture.userId,
      name: "Manager",
      restrictedToOrganizationId: null,
    },
    session: { token: "test-token", userId: fixture.userId },
    organizations: [{ id: fixture.organizationId }],
    memberships: [
      {
        membershipId: fixture.memberId,
        organizationId: fixture.organizationId,
        role: fixture.role,
      },
    ],
  });

  layer(TestLayer)("handlers", (it) => {
    it.effect("blocks, lists and unblocks an address", () =>
      Effect.gen(function* () {
        const handlers = yield* UserBlockRpcHandlersEffect;
        const fixture = yield* makeFixture();

        const blocked = yield* handlers
          .BlockUser({
            organizationId: fixture.organizationId,
            reason: "Abuse report",
            target: { _tag: "email", email: "Blocked@Example.com" },
          })
          .pipe(Effect.provideService(CurrentSession, session(fixture)));

        expect(blocked).toMatchObject({
          createdByName: "Manager",
          email: "blocked@example.com",
          reason: "Abuse report",
        });

        const listed = yield* handlers
          .ListUserBlocks({
            limit: 20,
            offset: 0,
            organizationId: fixture.organizationId,
            search: "blocked@",
          })
          .pipe(Effect.provideService(CurrentSession, session(fixture)));
        expect(listed.total).toBe(1);
        expect(listed.items[0]?.email).toBe("blocked@example.com");

        const status = yield* handlers
          .GetUserBlockStatus({
            organizationId: fixture.organizationId,
          })
          .pipe(
            Effect.provideService(
              OptionalCurrentSession,
              Option.some({
                ...session(fixture),
                memberships: [],
                user: {
                  ...session(fixture).user,
                  email: "blocked@example.com",
                },
              })
            )
          );
        expect(status.blocked).toBe(true);

        yield* handlers
          .UnblockUser({
            id: asLegid(UserBlockId)(blocked.id),
            organizationId: fixture.organizationId,
          })
          .pipe(Effect.provideService(CurrentSession, session(fixture)));

        const after = yield* handlers
          .GetUserBlockStatus({
            organizationId: fixture.organizationId,
          })
          .pipe(
            Effect.provideService(
              OptionalCurrentSession,
              Option.some({
                ...session(fixture),
                memberships: [],
                user: {
                  ...session(fixture).user,
                  email: "blocked@example.com",
                },
              })
            )
          );
        expect(after.blocked).toBe(false);
      })
    );

    it.effect("requires the manager permission", () =>
      Effect.gen(function* () {
        const handlers = yield* UserBlockRpcHandlersEffect;
        const fixture = yield* makeFixture("contributor");

        const error = yield* Effect.flip(
          handlers
            .BlockUser({
              organizationId: fixture.organizationId,
              target: { _tag: "email", email: "blocked@example.com" },
            })
            .pipe(Effect.provideService(CurrentSession, session(fixture)))
        );
        expect(error._tag).toBe("PolicyDenied");
      })
    );

    it.effect("refuses to block a workspace member", () =>
      Effect.gen(function* () {
        const handlers = yield* UserBlockRpcHandlersEffect;
        const fixture = yield* makeFixture();

        const error = yield* Effect.flip(
          handlers
            .BlockUser({
              organizationId: fixture.organizationId,
              target: { _tag: "user", userId: fixture.userId },
            })
            .pipe(Effect.provideService(CurrentSession, session(fixture)))
        );
        expect(error._tag).toBe("BadRequestError");
      })
    );

    it.effect("answers false for an anonymous viewer", () =>
      Effect.gen(function* () {
        const handlers = yield* UserBlockRpcHandlersEffect;
        const fixture = yield* makeFixture();

        const status = yield* handlers
          .GetUserBlockStatus({
            organizationId: fixture.organizationId,
          })
          .pipe(Effect.provideService(OptionalCurrentSession, Option.none()));
        expect(status.blocked).toBe(false);
      })
    );
  });
});
