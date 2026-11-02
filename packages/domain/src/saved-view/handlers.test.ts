import { describe, expect, layer } from "@effect/vitest";
import { currentDb, Database, schema } from "@feeblo/db";
import { emptyBoardQuery } from "@feeblo/domain-contracts/board-query";
import { SavedViewId, WorkspaceId } from "@feeblo/id";
import type { Role } from "@feeblo/permissions";
import { eq } from "drizzle-orm";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Predicate from "effect/Predicate";

import { CurrentSession, type Session } from "../session-middleware";
import { SavedViewRpcHandlersEffect } from "./handlers";
import { SavedViewRepository } from "./repository";

/**
 * Saved views are personal, and the RPC surface has to prove it rather than
 * trust the client: every case below drives two members of the *same* workspace
 * and checks the second cannot see, overwrite, or delete the first's rows. That
 * is the whole authorization story for this module — there is no role check to
 * fall back on, because every member may save their own views.
 */
describe("SavedViewRpcHandlers", () => {
  type Member = {
    membershipId: string;
    session: Session;
    userId: string;
  };

  type Fixture = {
    alice: Member;
    /** A board in the workspace, so a board-scoped view has a real target. */
    boardId: string;
    bob: Member;
    organizationId: string;
  };

  const makeMember = (
    organizationId: string,
    name: string,
    role: Role
  ): Member => {
    const userId = `user_${name}_${organizationId}`;
    const membershipId = `member_${name}_${organizationId}`;

    return {
      membershipId,
      session: {
        memberships: [{ membershipId, organizationId, role }],
        organizations: [{ id: organizationId }],
        session: { token: "token", userId },
        user: {
          email: `${name}@example.com`,
          id: userId,
          name,
          restrictedToOrganizationId: null,
        },
      },
      userId,
    };
  };

  const fixture = () =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      const organizationId = yield* WorkspaceId.generate;
      const now = yield* DateTime.nowAsDate;

      yield* db.insert(schema.organizationTable).values({
        id: organizationId,
        name: "Organization",
        slug: organizationId,
        createdAt: now,
      });

      const alice = makeMember(organizationId, "alice", "owner");
      const bob = makeMember(organizationId, "bob", "contributor");

      for (const member of [alice, bob]) {
        yield* db.insert(schema.userTable).values({
          id: member.userId,
          email: `${member.userId}@example.com`,
          name: member.userId,
        });
        yield* db.insert(schema.memberTable).values({
          id: member.membershipId,
          organizationId,
          role: "owner",
          userId: member.userId,
          createdAt: now,
        });
      }

      const boardId = `brd_${organizationId}`;
      yield* db.insert(schema.boardTable).values({
        id: boardId,
        name: "Board",
        slug: boardId,
        visibility: "PUBLIC",
        creatorId: alice.userId,
        creatorMemberId: alice.membershipId,
        organizationId,
        createdAt: now,
        updatedAt: now,
      });

      return { alice, boardId, bob, organizationId } satisfies Fixture;
    });

  /** Runs a handler as one member. */
  const as = <A, E, R>(
    member: Member,
    effect: Effect.Effect<A, E, R>
  ): Effect.Effect<A, E, Exclude<R, CurrentSession>> =>
    effect.pipe(Effect.provideService(CurrentSession, member.session));

  const TestLayer = Layer.merge(
    SavedViewRepository.layer.pipe(Layer.provide(Database.PgliteDatabaseLive)),
    Database.PgliteDatabaseLive
  );

  layer(TestLayer)("saved views", (it) => {
    it.effect("keeps one member's views out of another's list", () =>
      Effect.gen(function* () {
        const handlers = yield* SavedViewRpcHandlersEffect;
        const f = yield* fixture();
        const id = yield* SavedViewId.generate;

        yield* as(
          f.alice,
          handlers.CreateSavedView({
            boardId: null,
            id,
            name: "My triage",
            organizationId: f.organizationId,
            query: {
              filters: { ...emptyBoardQuery.filters, search: "billing" },
              ordering: emptyBoardQuery.ordering,
            },
          })
        );

        const aliceViews = yield* as(
          f.alice,
          handlers.ListSavedViews({
            boardId: null,
            organizationId: f.organizationId,
          })
        );
        const bobViews = yield* as(
          f.bob,
          handlers.ListSavedViews({
            boardId: null,
            organizationId: f.organizationId,
          })
        );

        expect(aliceViews.map((view) => view.name)).toEqual(["My triage"]);
        expect(aliceViews[0]?.query.filters.search).toBe("billing");
        expect(bobViews).toEqual([]);
      })
    );

    it.effect("separates the feedback list from one board's views", () =>
      Effect.gen(function* () {
        const handlers = yield* SavedViewRpcHandlersEffect;
        const f = yield* fixture();
        const id = yield* SavedViewId.generate;

        yield* as(
          f.alice,
          handlers.CreateSavedView({
            boardId: f.boardId,
            id,
            name: "Checkout bugs",
            organizationId: f.organizationId,
            query: emptyBoardQuery,
          })
        );

        const boardViews = yield* as(
          f.alice,
          handlers.ListSavedViews({
            boardId: f.boardId,
            organizationId: f.organizationId,
          })
        );
        const feedbackViews = yield* as(
          f.alice,
          handlers.ListSavedViews({
            boardId: null,
            organizationId: f.organizationId,
          })
        );

        expect(boardViews.map((view) => view.name)).toEqual(["Checkout bugs"]);
        expect(feedbackViews).toEqual([]);
      })
    );

    it.effect("refuses to update or delete another member's view", () =>
      Effect.gen(function* () {
        const handlers = yield* SavedViewRpcHandlersEffect;
        const f = yield* fixture();
        const id = yield* SavedViewId.generate;

        yield* as(
          f.alice,
          handlers.CreateSavedView({
            boardId: null,
            id,
            name: "Mine",
            organizationId: f.organizationId,
            query: emptyBoardQuery,
          })
        );

        const updateError = yield* as(
          f.bob,
          handlers.UpdateSavedView({
            id,
            name: "Stolen",
            organizationId: f.organizationId,
            query: emptyBoardQuery,
          })
        ).pipe(Effect.flip);
        const deleteError = yield* as(
          f.bob,
          handlers.DeleteSavedView({ id, organizationId: f.organizationId })
        ).pipe(Effect.flip);

        expect(Predicate.isTagged(updateError, "NotFoundError")).toBe(true);
        expect(Predicate.isTagged(deleteError, "NotFoundError")).toBe(true);

        // Alice's row is untouched by either attempt.
        const aliceViews = yield* as(
          f.alice,
          handlers.ListSavedViews({
            boardId: null,
            organizationId: f.organizationId,
          })
        );
        expect(aliceViews.map((view) => view.name)).toEqual(["Mine"]);
      })
    );

    it.effect("rejects a non-member with a policy failure", () =>
      Effect.gen(function* () {
        const handlers = yield* SavedViewRpcHandlersEffect;
        const f = yield* fixture();
        const outsider = makeMember("org_somewhere_else", "mallory", "owner");

        const error = yield* as(
          outsider,
          handlers.ListSavedViews({
            boardId: null,
            organizationId: f.organizationId,
          })
        ).pipe(Effect.flip);

        expect(Predicate.isTagged(error, "PolicyDenied")).toBe(true);
      })
    );

    it.effect("treats a duplicate name on one surface as a bad request", () =>
      Effect.gen(function* () {
        const handlers = yield* SavedViewRpcHandlersEffect;
        const f = yield* fixture();
        const db = yield* currentDb;
        const first = yield* SavedViewId.generate;

        yield* as(
          f.alice,
          handlers.CreateSavedView({
            boardId: null,
            id: first,
            name: "Triage",
            organizationId: f.organizationId,
            query: emptyBoardQuery,
          })
        );

        const second = yield* SavedViewId.generate;
        const error = yield* as(
          f.alice,
          handlers.CreateSavedView({
            boardId: null,
            id: second,
            name: "Triage",
            organizationId: f.organizationId,
            query: emptyBoardQuery,
          })
        ).pipe(Effect.flip);

        expect(Predicate.isTagged(error, "BadRequestError")).toBe(true);

        // The rejected insert left no row behind.
        const rows = yield* db
          .select({ id: schema.savedViewTable.id })
          .from(schema.savedViewTable)
          .where(eq(schema.savedViewTable.id, second));
        expect(rows).toEqual([]);
      })
    );
  });
});
