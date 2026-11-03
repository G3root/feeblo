import { describe, expect, layer } from "@effect/vitest";
import { currentDb, Database, schema } from "@feeblo/db";
import { emptyBoardQuery } from "@feeblo/domain-contracts/board-query";
import { SavedViewId, WorkspaceId } from "@feeblo/id";
import type { Role } from "@feeblo/permissions";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Predicate from "effect/Predicate";

import { BoardRepository } from "../board/repository";
import { CurrentSession, type Session } from "../session-middleware";
import { SavedViewRpcHandlersEffect } from "./handlers";
import { SavedViewRepository } from "./repository";

/**
 * Saved views are private by default and shared only when their owner says so.
 * The RPC surface has to prove that rather than trust the client: every case
 * below drives two members of the *same* workspace and checks the second cannot
 * see a private row, and cannot overwrite or delete even a shared one. Sharing
 * changes visibility, not ownership.
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

  const TestLayer = Layer.mergeAll(
    SavedViewRepository.layer.pipe(Layer.provide(Database.PgliteDatabaseLive)),
    BoardRepository.layer.pipe(Layer.provide(Database.PgliteDatabaseLive)),
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
            description: null,
            isPrivate: true,
            name: "My triage",
            organizationId: f.organizationId,
            query: {
              ...emptyBoardQuery,
              filters: { ...emptyBoardQuery.filters, search: "billing" },
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

    it.effect(
      "shares a public view and keeps a private view to its owner",
      () =>
        Effect.gen(function* () {
          const handlers = yield* SavedViewRpcHandlersEffect;
          const f = yield* fixture();

          for (const [name, isPrivate] of [
            ["Shared triage", false],
            ["Private triage", true],
          ] as const) {
            yield* as(
              f.alice,
              handlers.CreateSavedView({
                boardId: null,
                description: null,
                id: yield* SavedViewId.generate,
                isPrivate,
                name,
                organizationId: f.organizationId,
                query: emptyBoardQuery,
              })
            );
          }

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

          expect(aliceViews.map((view) => view.name)).toEqual([
            "Shared triage",
            "Private triage",
          ]);
          expect(bobViews.map((view) => view.name)).toEqual(["Shared triage"]);
          expect(bobViews[0]?.memberId).toBe(f.alice.membershipId);
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
            description: null,
            isPrivate: true,
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

    it.effect("replaces a view's name and query in place", () =>
      Effect.gen(function* () {
        const handlers = yield* SavedViewRpcHandlersEffect;
        const f = yield* fixture();
        const id = yield* SavedViewId.generate;

        yield* as(
          f.alice,
          handlers.CreateSavedView({
            boardId: null,
            id,
            description: null,
            isPrivate: true,
            name: "Mine",
            organizationId: f.organizationId,
            query: emptyBoardQuery,
          })
        );

        yield* as(
          f.alice,
          handlers.UpdateSavedView({
            id,
            description: null,
            isPrivate: true,
            name: "Renamed",
            organizationId: f.organizationId,
            query: {
              ...emptyBoardQuery,
              filters: { ...emptyBoardQuery.filters, search: "checkout" },
              ordering: { direction: "asc", field: "title" },
            },
          })
        );

        const views = yield* as(
          f.alice,
          handlers.ListSavedViews({
            boardId: null,
            organizationId: f.organizationId,
          })
        );

        // One row, renamed and re-queried: "save current view" over an applied
        // view is an update, not a second view.
        expect(views).toHaveLength(1);
        expect(views[0]?.id).toBe(id);
        expect(views[0]?.name).toBe("Renamed");
        expect(views[0]?.query.filters.search).toBe("checkout");
        expect(views[0]?.query.ordering).toEqual({
          direction: "asc",
          field: "title",
        });
      })
    );

    it.effect("keeps the stored query when an update omits it", () =>
      Effect.gen(function* () {
        const handlers = yield* SavedViewRpcHandlersEffect;
        const repository = yield* SavedViewRepository;
        const f = yield* fixture();
        const id = yield* SavedViewId.generate;

        yield* as(
          f.alice,
          handlers.CreateSavedView({
            boardId: null,
            id,
            description: null,
            isPrivate: true,
            name: "Mine",
            organizationId: f.organizationId,
            query: {
              ...emptyBoardQuery,
              filters: { ...emptyBoardQuery.filters, search: "checkout" },
            },
          })
        );

        yield* as(
          f.alice,
          handlers.UpdateSavedView({
            id,
            description: "Renamed only",
            isPrivate: true,
            name: "Renamed",
            organizationId: f.organizationId,
          })
        );

        const renamed = yield* as(
          f.alice,
          handlers.ListSavedViews({
            boardId: null,
            organizationId: f.organizationId,
          })
        );

        expect(renamed[0]?.name).toBe("Renamed");
        expect(renamed[0]?.description).toBe("Renamed only");
        expect(renamed[0]?.query.filters.search).toBe("checkout");

        // The metadata-only write leaves `query` out of its `set` clause. This
        // gate pauses such an update after its ownership read, so a query
        // update can commit while the metadata update still holds the stale
        // row that read returned. The resumed metadata write must not put that
        // stale query back.
        const read = yield* Deferred.make<void>();
        const resume = yield* Deferred.make<void>();
        const gatedHandlers = yield* SavedViewRpcHandlersEffect.pipe(
          Effect.provideService(
            SavedViewRepository,
            SavedViewRepository.of({
              ...repository,
              findOwned: (args) =>
                repository
                  .findOwned(args)
                  .pipe(
                    Effect.tap(() =>
                      Deferred.succeed(read, undefined).pipe(
                        Effect.andThen(Deferred.await(resume))
                      )
                    )
                  ),
            })
          )
        );

        const metadataUpdate = yield* as(
          f.alice,
          gatedHandlers.UpdateSavedView({
            id,
            description: "Renamed concurrently",
            isPrivate: true,
            name: "Renamed concurrently",
            organizationId: f.organizationId,
          })
        ).pipe(Effect.forkChild);

        yield* Deferred.await(read);

        yield* as(
          f.alice,
          handlers.UpdateSavedView({
            id,
            description: "Query edit",
            isPrivate: true,
            name: "Query edit",
            organizationId: f.organizationId,
            query: {
              ...emptyBoardQuery,
              filters: { ...emptyBoardQuery.filters, search: "refund" },
            },
          })
        );

        yield* Deferred.succeed(resume, undefined);
        yield* Fiber.join(metadataUpdate);

        const [concurrent] = yield* as(
          f.alice,
          handlers.ListSavedViews({
            boardId: null,
            organizationId: f.organizationId,
          })
        );

        expect(concurrent?.name).toBe("Renamed concurrently");
        expect(concurrent?.description).toBe("Renamed concurrently");
        expect(concurrent?.query.filters.search).toBe("refund");
      })
    );

    it.effect("trims a description and stores a blank one as null", () =>
      Effect.gen(function* () {
        const handlers = yield* SavedViewRpcHandlersEffect;
        const f = yield* fixture();

        yield* as(
          f.alice,
          handlers.CreateSavedView({
            boardId: null,
            description: "  Checkout regressions  ",
            isPrivate: true,
            id: yield* SavedViewId.generate,
            name: "Checkout",
            organizationId: f.organizationId,
            query: emptyBoardQuery,
          })
        );
        yield* as(
          f.alice,
          handlers.CreateSavedView({
            boardId: null,
            description: "   ",
            isPrivate: true,
            id: yield* SavedViewId.generate,
            name: "Blank note",
            organizationId: f.organizationId,
            query: emptyBoardQuery,
          })
        );

        const views = yield* as(
          f.alice,
          handlers.ListSavedViews({
            boardId: null,
            organizationId: f.organizationId,
          })
        );

        expect(views.map((view) => view.description)).toEqual([
          "Checkout regressions",
          // Not `""`: one spelling of "no description" in the row.
          null,
        ]);
      })
    );

    it.effect("stores the query in canonical form", () =>
      Effect.gen(function* () {
        const handlers = yield* SavedViewRpcHandlersEffect;
        const f = yield* fixture();

        yield* as(
          f.alice,
          handlers.CreateSavedView({
            boardId: null,
            description: null,
            isPrivate: true,
            id: yield* SavedViewId.generate,
            name: "Canonical",
            organizationId: f.organizationId,
            query: {
              ...emptyBoardQuery,
              filters: {
                assigneeMemberIds: ["mem_b", "mem_a"],
                search: "  checkout  ",
                status: {
                  operator: "isAnyOf",
                  types: ["IN_PROGRESS", "PLANNED"],
                },
                tag: { operator: "includeAnyOf", tagIds: ["tag_b", "tag_a"] },
              },
            },
          })
        );

        const [view] = yield* as(
          f.alice,
          handlers.ListSavedViews({
            boardId: null,
            organizationId: f.organizationId,
          })
        );

        // Ids sorted, statuses in display order, the search term trimmed, so
        // two clients that picked the same filters in a different sequence
        // store the same row.
        expect(view?.query.filters).toEqual({
          assigneeMemberIds: ["mem_a", "mem_b"],
          search: "checkout",
          status: { operator: "isAnyOf", types: ["PLANNED", "IN_PROGRESS"] },
          tag: { operator: "includeAnyOf", tagIds: ["tag_a", "tag_b"] },
        });
      })
    );

    it.effect("appends new views and rewrites the order on reorder", () =>
      Effect.gen(function* () {
        const handlers = yield* SavedViewRpcHandlersEffect;
        const f = yield* fixture();
        const list = () =>
          as(
            f.alice,
            handlers.ListSavedViews({
              boardId: null,
              organizationId: f.organizationId,
            })
          );

        const first = yield* SavedViewId.generate;
        const second = yield* SavedViewId.generate;
        const third = yield* SavedViewId.generate;

        for (const [id, name] of [
          [first, "First"],
          [second, "Second"],
          [third, "Third"],
        ] as const) {
          yield* as(
            f.alice,
            handlers.CreateSavedView({
              boardId: null,
              description: null,
              isPrivate: true,
              id,
              name,
              organizationId: f.organizationId,
              query: emptyBoardQuery,
            })
          );
        }

        expect((yield* list()).map((view) => view.name)).toEqual([
          "First",
          "Second",
          "Third",
        ]);
        expect((yield* list()).map((view) => view.orderIndex)).toEqual([
          0, 1, 2,
        ]);

        yield* as(
          f.alice,
          handlers.ReorderSavedViews({
            boardId: null,
            orderedIds: [third, first, second],
            organizationId: f.organizationId,
          })
        );

        const reordered = yield* list();
        expect(reordered.map((view) => view.name)).toEqual([
          "Third",
          "First",
          "Second",
        ]);
        expect(reordered.map((view) => view.orderIndex)).toEqual([0, 1, 2]);
      })
    );

    it.effect("refuses an order that does not name this surface's views", () =>
      Effect.gen(function* () {
        const handlers = yield* SavedViewRpcHandlersEffect;
        const f = yield* fixture();
        const first = yield* SavedViewId.generate;
        const second = yield* SavedViewId.generate;

        for (const [id, name] of [
          [first, "First"],
          [second, "Second"],
        ] as const) {
          yield* as(
            f.alice,
            handlers.CreateSavedView({
              boardId: null,
              description: null,
              isPrivate: true,
              id,
              name,
              organizationId: f.organizationId,
              query: emptyBoardQuery,
            })
          );
        }

        // A partial list would leave the unnamed view at a stale index.
        const partial = yield* as(
          f.alice,
          handlers.ReorderSavedViews({
            boardId: null,
            orderedIds: [first],
            organizationId: f.organizationId,
          })
        ).pipe(Effect.flip);
        // An id from another member's surface is not the caller's to order.
        const foreign = yield* as(
          f.bob,
          handlers.ReorderSavedViews({
            boardId: null,
            orderedIds: [first, second],
            organizationId: f.organizationId,
          })
        ).pipe(Effect.flip);

        expect(Predicate.isTagged(partial, "BadRequestError")).toBe(true);
        expect(Predicate.isTagged(foreign, "BadRequestError")).toBe(true);
      })
    );

    it.effect("refuses to update or delete another member's shared view", () =>
      Effect.gen(function* () {
        const handlers = yield* SavedViewRpcHandlersEffect;
        const f = yield* fixture();
        const id = yield* SavedViewId.generate;

        yield* as(
          f.alice,
          handlers.CreateSavedView({
            boardId: null,
            id,
            description: null,
            isPrivate: false,
            name: "Mine",
            organizationId: f.organizationId,
            query: emptyBoardQuery,
          })
        );

        const updateError = yield* as(
          f.bob,
          handlers.UpdateSavedView({
            id,
            description: null,
            isPrivate: false,
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

    it.effect("refuses a board that belongs to another workspace", () =>
      Effect.gen(function* () {
        const handlers = yield* SavedViewRpcHandlersEffect;
        const f = yield* fixture();
        const db = yield* currentDb;
        const otherOrganizationId = yield* WorkspaceId.generate;
        const otherBoardId = `brd_${otherOrganizationId}`;
        const now = yield* DateTime.nowAsDate;

        yield* db.insert(schema.organizationTable).values({
          id: otherOrganizationId,
          name: "Other organization",
          slug: otherOrganizationId,
          createdAt: now,
        });
        yield* db.insert(schema.boardTable).values({
          id: otherBoardId,
          name: "Other board",
          slug: otherBoardId,
          visibility: "PUBLIC",
          creatorId: f.alice.userId,
          creatorMemberId: f.alice.membershipId,
          organizationId: otherOrganizationId,
          createdAt: now,
          updatedAt: now,
        });

        const error = yield* as(
          f.alice,
          handlers.CreateSavedView({
            boardId: otherBoardId,
            description: null,
            id: yield* SavedViewId.generate,
            isPrivate: true,
            name: "Wrong workspace",
            organizationId: f.organizationId,
            query: emptyBoardQuery,
          })
        ).pipe(Effect.flip);

        expect(Predicate.isTagged(error, "BadRequestError")).toBe(true);
        expect(
          yield* as(
            f.alice,
            handlers.ListSavedViews({
              boardId: otherBoardId,
              organizationId: f.organizationId,
            })
          )
        ).toEqual([]);
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

    it.effect("allows two views to share a name on one surface", () =>
      Effect.gen(function* () {
        const handlers = yield* SavedViewRpcHandlersEffect;
        const f = yield* fixture();

        for (const [id, name] of [
          [yield* SavedViewId.generate, "Triage"],
          [yield* SavedViewId.generate, "Triage"],
        ] as const) {
          yield* as(
            f.alice,
            handlers.CreateSavedView({
              boardId: null,
              description: null,
              isPrivate: true,
              id,
              name,
              organizationId: f.organizationId,
              query: emptyBoardQuery,
            })
          );
        }

        const views = yield* as(
          f.alice,
          handlers.ListSavedViews({
            boardId: null,
            organizationId: f.organizationId,
          })
        );

        // Names are a label, not an identity: duplicating a view to try a
        // variation should not need an invented suffix first.
        expect(views.map((view) => view.name)).toEqual(["Triage", "Triage"]);
        expect(views.map((view) => view.id)).toHaveLength(
          new Set(views.map((view) => view.id)).size
        );
      })
    );
  });
});
