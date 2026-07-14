import { describe, expect, layer } from "@effect/vitest";
import { currentDb, Database, schema } from "@feeblo/db";
import { BoardId, type LegidOf, PostId, PostStatusId, WorkspaceId } from "@feeblo/id";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { PostPolicy } from "../post/policies";
import { PostRepository } from "../post/repository";
import { CurrentSession, type Session } from "../session-middleware";
import { PostSubscriptionRpcHandlersEffect } from "./handlers";
import { PostSubscriptionRepository } from "./repository";

describe("PostSubscriptionRpcHandlers", () => {
  type Fixture = { membershipId: string; organizationId: LegidOf<"WorkspaceId">; postId: LegidOf<"PostId">; userId: string };
  const session = (f: Fixture, member = true): Session => ({ user: { id: f.userId, email: "user@example.com", name: "User", restrictedToOrganizationId: null }, session: { userId: f.userId, token: "token" }, organizations: [{ id: f.organizationId }], memberships: member ? [{ membershipId: f.membershipId, organizationId: f.organizationId, role: "owner" }] : [] });
  const fixture = (visibility: "PUBLIC" | "PRIVATE" = "PUBLIC") => Effect.gen(function* () {
    const db = yield* currentDb; const organizationId = yield* WorkspaceId.generate; const boardId = yield* BoardId.generate; const postId = yield* PostId.generate; const statusId = yield* PostStatusId.generate; const userId = `user_${organizationId}`; const membershipId = `member_${organizationId}`; const now = new Date();
    yield* db.insert(schema.organizationTable).values({ id: organizationId, name: "Organization", slug: organizationId, createdAt: now });
    yield* db.insert(schema.userTable).values({ id: userId, email: `${organizationId}@example.com`, name: "User" });
    yield* db.insert(schema.memberTable).values({ id: membershipId, organizationId, userId, role: "owner", createdAt: now });
    yield* db.insert(schema.boardTable).values({ id: boardId, name: "Board", slug: boardId, visibility, organizationId, creatorId: userId, creatorMemberId: membershipId, createdAt: now, updatedAt: now });
    yield* db.insert(schema.postStatusTable).values({ id: statusId, type: "PENDING", orderIndex: 0, organizationId });
    yield* db.insert(schema.postTable).values({ id: postId, title: "Post", content: "Content", slug: postId, excerpt: "Content", boardId, organizationId, statusId, creatorId: userId, creatorMemberId: membershipId, createdAt: now, updatedAt: now });
    return { membershipId, organizationId, postId, userId } satisfies Fixture;
  });
  const Repositories = Layer.mergeAll(PostRepository.layer, PostSubscriptionRepository.layer).pipe(Layer.provide(Database.PgliteDatabaseLive));
  const TestLayer = PostPolicy.layer.pipe(Layer.provideMerge(Repositories));

  layer(Layer.merge(TestLayer, Database.PgliteDatabaseLive))("handlers", (it) => {
    it.effect("does not expose subscribers to users without a membership", () => Effect.gen(function* () {
      const handlers = yield* PostSubscriptionRpcHandlersEffect; const f = yield* fixture();
      const error = yield* Effect.flip(handlers.PostSubscriptionList({ organizationId: f.organizationId, postId: f.postId }).pipe(Effect.provideService(CurrentSession, session(f, false))));
      expect(error._tag).toBe("PolicyDenied");
    }));
    it.effect("subscribes, lists, and unsubscribes members", () => Effect.gen(function* () {
      const handlers = yield* PostSubscriptionRpcHandlersEffect; const f = yield* fixture(); const input = { organizationId: f.organizationId, postId: f.postId };
      expect(yield* handlers.PostSubscriptionCreate(input).pipe(Effect.provideService(CurrentSession, session(f)))).toEqual({ subscribed: true });
      expect(yield* handlers.PostSubscriptionList(input).pipe(Effect.provideService(CurrentSession, session(f)))).toMatchObject([{ postId: f.postId, userId: f.userId, memberId: f.membershipId }]);
      expect(yield* handlers.PostSubscriptionDelete(input).pipe(Effect.provideService(CurrentSession, session(f)))).toEqual({ subscribed: false });
      expect(yield* handlers.PostSubscriptionList(input).pipe(Effect.provideService(CurrentSession, session(f)))).toHaveLength(0);
    }));
    it.effect("creates public subscriptions without a membership", () => Effect.gen(function* () {
      const handlers = yield* PostSubscriptionRpcHandlersEffect; const f = yield* fixture("PUBLIC"); const input = { organizationId: f.organizationId, postId: f.postId };
      expect(yield* handlers.PostSubscriptionCreatePublic(input).pipe(Effect.provideService(CurrentSession, session(f, false)))).toEqual({ subscribed: true });
      expect(yield* handlers.PostSubscriptionListPublic(input)).toMatchObject([{ userId: f.userId, memberId: null }]);
    }));
  });
});
