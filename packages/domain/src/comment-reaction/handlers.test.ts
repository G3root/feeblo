import { describe, expect, layer } from "@effect/vitest";
import { currentDb, Database, schema } from "@feeblo/db";
import { BoardId, CommentId, type LegidOf, PostId, PostStatusId, WorkspaceId } from "@feeblo/id";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { PostPolicy } from "../post/policies";
import { PostRepository } from "../post/repository";
import { CurrentSession, type Session } from "../session-middleware";
import { CommentReactionRpcHandlersEffect } from "./handlers";
import { CommentReactionRepository } from "./repository";

describe("CommentReactionRpcHandlers", () => {
  type Fixture = { commentId: LegidOf<"CommentId">; membershipId: string; organizationId: LegidOf<"WorkspaceId">; postId: LegidOf<"PostId">; userId: string };
  const session = (f: Fixture, member = true): Session => ({ user: { id: f.userId, email: "user@example.com", name: "User", restrictedToOrganizationId: null }, session: { userId: f.userId, token: "token" }, organizations: [{ id: f.organizationId }], memberships: member ? [{ membershipId: f.membershipId, organizationId: f.organizationId, role: "owner" }] : [] });
  const fixture = (visibility: "PUBLIC" | "PRIVATE" = "PUBLIC") => Effect.gen(function* () {
    const db = yield* currentDb; const organizationId = yield* WorkspaceId.generate; const boardId = yield* BoardId.generate; const postId = yield* PostId.generate; const commentId = yield* CommentId.generate; const statusId = yield* PostStatusId.generate; const userId = `user_${organizationId}`; const membershipId = `member_${organizationId}`; const now = new Date();
    yield* db.insert(schema.organizationTable).values({ id: organizationId, name: "Organization", slug: organizationId, createdAt: now });
    yield* db.insert(schema.userTable).values({ id: userId, email: `${organizationId}@example.com`, name: "User" });
    yield* db.insert(schema.memberTable).values({ id: membershipId, organizationId, userId, role: "owner", createdAt: now });
    yield* db.insert(schema.boardTable).values({ id: boardId, name: "Board", slug: boardId, visibility, organizationId, creatorId: userId, creatorMemberId: membershipId, createdAt: now, updatedAt: now });
    yield* db.insert(schema.postStatusTable).values({ id: statusId, type: "PENDING", orderIndex: 0, organizationId });
    yield* db.insert(schema.postTable).values({ id: postId, title: "Post", content: "Content", slug: postId, excerpt: "Content", boardId, organizationId, statusId, creatorId: userId, creatorMemberId: membershipId, createdAt: now, updatedAt: now });
    yield* db.insert(schema.commentTable).values({ id: commentId, content: "Comment", organizationId, postId, userId, memberId: membershipId, visibility: "PUBLIC", createdAt: now, updatedAt: now, parentCommentId: null });
    return { commentId, membershipId, organizationId, postId, userId } satisfies Fixture;
  });
  const Repositories = Layer.mergeAll(PostRepository.layer, CommentReactionRepository.layer).pipe(Layer.provide(Database.PgliteDatabaseLive));
  const TestLayer = PostPolicy.layer.pipe(Layer.provideMerge(Repositories));

  layer(Layer.merge(TestLayer, Database.PgliteDatabaseLive))("handlers", (it) => {
    it.effect("does not list reactions for users without a membership", () => Effect.gen(function* () {
      const handlers = yield* CommentReactionRpcHandlersEffect; const f = yield* fixture();
      const error = yield* Effect.flip(handlers.CommentReactionList({ organizationId: f.organizationId, postId: f.postId }).pipe(Effect.provideService(CurrentSession, session(f, false))));
      expect(error._tag).toBe("PolicyDenied");
    }));
    it.effect("toggles a member reaction on a comment", () => Effect.gen(function* () {
      const handlers = yield* CommentReactionRpcHandlersEffect; const f = yield* fixture();
      const input = { organizationId: f.organizationId, postId: f.postId, commentId: f.commentId, emoji: "rocket" as const };
      expect(yield* handlers.CommentReactionToggle(input).pipe(Effect.provideService(CurrentSession, session(f)))).toEqual({ reacted: true, emoji: "rocket" });
      const reactions = yield* handlers.CommentReactionList(input).pipe(Effect.provideService(CurrentSession, session(f)));
      expect(reactions).toHaveLength(1); expect(reactions[0]).toMatchObject({ commentId: f.commentId, userId: f.userId, memberId: f.membershipId, emoji: "rocket" });
    }));
    it.effect("does not react to comments on private boards through the public endpoint", () => Effect.gen(function* () {
      const handlers = yield* CommentReactionRpcHandlersEffect; const f = yield* fixture("PRIVATE");
      const error = yield* Effect.flip(handlers.CommentReactionTogglePublic({ organizationId: f.organizationId, postId: f.postId, commentId: f.commentId, emoji: "fire" }).pipe(Effect.provideService(CurrentSession, session(f, false))));
      expect(error._tag).toBe("PolicyDenied");
    }));
  });
});
