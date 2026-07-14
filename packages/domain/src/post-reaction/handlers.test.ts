import { describe, expect, layer } from "@effect/vitest";
import { currentDb, Database, schema } from "@feeblo/db";
import { BoardId, type LegidOf, PostId, PostStatusId, WorkspaceId } from "@feeblo/id";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { PostPolicy } from "../post/policies";
import { PostRepository } from "../post/repository";
import { CurrentSession, type Session } from "../session-middleware";
import { PostReactionRpcHandlersEffect } from "./handlers";
import { PostReactionRepository } from "./repository";

describe("PostReactionRpcHandlers", () => {
  type Fixture = { boardId: LegidOf<"BoardId">; membershipId: string; organizationId: LegidOf<"WorkspaceId">; postId: LegidOf<"PostId">; userId: string };
  const session = (f: Fixture, member = true): Session => ({ user: { id: f.userId, email: "user@example.com", name: "User", restrictedToOrganizationId: null }, session: { userId: f.userId, token: "token" }, organizations: [{ id: f.organizationId }], memberships: member ? [{ membershipId: f.membershipId, organizationId: f.organizationId, role: "owner" }] : [] });
  const fixture = (visibility: "PUBLIC" | "PRIVATE" = "PUBLIC") => Effect.gen(function* () {
    const db = yield* currentDb; const organizationId = yield* WorkspaceId.generate; const boardId = yield* BoardId.generate; const postId = yield* PostId.generate; const statusId = yield* PostStatusId.generate; const userId = `user_${organizationId}`; const membershipId = `member_${organizationId}`; const now = new Date();
    yield* db.insert(schema.organizationTable).values({ id: organizationId, name: "Organization", slug: organizationId, createdAt: now });
    yield* db.insert(schema.userTable).values({ id: userId, email: `${organizationId}@example.com`, name: "User" });
    yield* db.insert(schema.memberTable).values({ id: membershipId, organizationId, userId, role: "owner", createdAt: now });
    yield* db.insert(schema.boardTable).values({ id: boardId, name: "Board", slug: boardId, visibility, organizationId, creatorId: userId, creatorMemberId: membershipId, createdAt: now, updatedAt: now });
    yield* db.insert(schema.postStatusTable).values({ id: statusId, type: "PENDING", orderIndex: 0, organizationId });
    yield* db.insert(schema.postTable).values({ id: postId, title: "Post", content: "Content", slug: postId, excerpt: "Content", boardId, organizationId, statusId, creatorId: userId, creatorMemberId: membershipId, createdAt: now, updatedAt: now });
    return { boardId, membershipId, organizationId, postId, userId } satisfies Fixture;
  });
  const Repositories = Layer.mergeAll(PostRepository.layer, PostReactionRepository.layer).pipe(Layer.provide(Database.PgliteDatabaseLive));
  const TestLayer = PostPolicy.layer.pipe(Layer.provideMerge(Repositories));

  layer(Layer.merge(TestLayer, Database.PgliteDatabaseLive))("handlers", (it) => {
    it.effect("lists reactions only for members", () => Effect.gen(function* () {
      const handlers = yield* PostReactionRpcHandlersEffect; const f = yield* fixture();
      const error = yield* Effect.flip(handlers.PostReactionList({ organizationId: f.organizationId, postId: f.postId }).pipe(Effect.provideService(CurrentSession, session(f, false))));
      expect(error._tag).toBe("PolicyDenied");
    }));
    it.effect("toggles a member reaction and returns it in the list", () => Effect.gen(function* () {
      const handlers = yield* PostReactionRpcHandlersEffect; const f = yield* fixture();
      const input = { organizationId: f.organizationId, postId: f.postId, emoji: "thumbs_up" as const };
      expect(yield* handlers.PostReactionToggle(input).pipe(Effect.provideService(CurrentSession, session(f)))).toEqual({ reacted: true, emoji: "thumbs_up" });
      const reactions = yield* handlers.PostReactionList(input).pipe(Effect.provideService(CurrentSession, session(f)));
      expect(reactions).toHaveLength(1); expect(reactions[0]).toMatchObject({ postId: f.postId, userId: f.userId, memberId: f.membershipId, emoji: "thumbs_up" });
      expect(yield* handlers.PostReactionToggle(input).pipe(Effect.provideService(CurrentSession, session(f)))).toEqual({ reacted: false, emoji: null });
    }));
    it.effect("permits public reactions only on public boards", () => Effect.gen(function* () {
      const handlers = yield* PostReactionRpcHandlersEffect; const publicFixture = yield* fixture("PUBLIC"); const privateFixture = yield* fixture("PRIVATE");
      const publicResult = yield* handlers.PostReactionTogglePublic({ organizationId: publicFixture.organizationId, postId: publicFixture.postId, emoji: "fire" }).pipe(Effect.provideService(CurrentSession, session(publicFixture, false)));
      const privateError = yield* Effect.flip(handlers.PostReactionTogglePublic({ organizationId: privateFixture.organizationId, postId: privateFixture.postId, emoji: "fire" }).pipe(Effect.provideService(CurrentSession, session(privateFixture, false))));
      expect(publicResult).toEqual({ reacted: true, emoji: "fire" }); expect(privateError._tag).toBe("PolicyDenied");
    }));
  });
});
