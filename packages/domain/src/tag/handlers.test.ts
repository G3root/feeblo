import { describe, expect, layer } from "@effect/vitest";
import { currentDb, Database, schema } from "@feeblo/db";
import { BoardId, type LegidOf, PostId, PostStatusId, TagId, WorkspaceId } from "@feeblo/id";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { CurrentSession, type Session } from "../session-middleware";
import { TagRpcHandlersEffect } from "./handlers";
import { TagPolicy } from "./policies";
import { TagRepository } from "./repository";

describe("TagRpcHandlers", () => {
  type Fixture = { membershipId: string; organizationId: LegidOf<"WorkspaceId">; postId: LegidOf<"PostId">; userId: string };
  const session = (f: Fixture, member = true): Session => ({ user: { id: f.userId, email: "user@example.com", name: "User", restrictedToOrganizationId: null }, session: { userId: f.userId, token: "token" }, organizations: [{ id: f.organizationId }], memberships: member ? [{ membershipId: f.membershipId, organizationId: f.organizationId, role: "owner" }] : [] });
  const fixture = () => Effect.gen(function* () {
    const db = yield* currentDb; const organizationId = yield* WorkspaceId.generate; const boardId = yield* BoardId.generate; const postId = yield* PostId.generate; const statusId = yield* PostStatusId.generate; const userId = `user_${organizationId}`; const membershipId = `member_${organizationId}`; const now = new Date();
    yield* db.insert(schema.organizationTable).values({ id: organizationId, name: "Organization", slug: organizationId, createdAt: now });
    yield* db.insert(schema.userTable).values({ id: userId, email: `${organizationId}@example.com`, name: "User" });
    yield* db.insert(schema.memberTable).values({ id: membershipId, organizationId, userId, role: "owner", createdAt: now });
    yield* db.insert(schema.boardTable).values({ id: boardId, name: "Board", slug: boardId, visibility: "PUBLIC", organizationId, creatorId: userId, creatorMemberId: membershipId, createdAt: now, updatedAt: now });
    yield* db.insert(schema.postStatusTable).values({ id: statusId, type: "PENDING", orderIndex: 0, organizationId });
    yield* db.insert(schema.postTable).values({ id: postId, title: "Post", content: "Content", slug: postId, excerpt: "Content", boardId, organizationId, statusId, creatorId: userId, creatorMemberId: membershipId, createdAt: now, updatedAt: now });
    return { membershipId, organizationId, postId, userId } satisfies Fixture;
  });
  const Repositories = TagRepository.layer.pipe(Layer.provide(Database.PgliteDatabaseLive));
  const TestLayer = TagPolicy.layer.pipe(Layer.provideMerge(Repositories));

  layer(Layer.merge(TestLayer, Database.PgliteDatabaseLive))("handlers", (it) => {
    it.effect("lists tags only for members while the public endpoint remains readable", () => Effect.gen(function* () {
      const handlers = yield* TagRpcHandlersEffect; const f = yield* fixture(); const tagId = yield* TagId.generate;
      yield* handlers.TagCreate({ id: tagId, name: "Feature", type: "FEEDBACK", organizationId: f.organizationId }).pipe(Effect.provideService(CurrentSession, session(f)));
      const error = yield* Effect.flip(handlers.TagList({ organizationId: f.organizationId }).pipe(Effect.provideService(CurrentSession, session(f, false))));
      expect(error._tag).toBe("PolicyDenied");
      expect(yield* handlers.TagListPublic({ organizationId: f.organizationId })).toMatchObject([{ id: tagId, name: "Feature", type: "FEEDBACK" }]);
    }));
    it.effect("allows tag creators to update their tags", () => Effect.gen(function* () {
      const handlers = yield* TagRpcHandlersEffect; const f = yield* fixture(); const tagId = yield* TagId.generate;
      yield* handlers.TagCreate({ id: tagId, name: "Old name", type: "FEEDBACK", organizationId: f.organizationId }).pipe(Effect.provideService(CurrentSession, session(f)));
      yield* handlers.TagUpdate({ id: tagId, name: "New name", type: "FEEDBACK", organizationId: f.organizationId }).pipe(Effect.provideService(CurrentSession, session(f)));
      expect(yield* handlers.TagList({ organizationId: f.organizationId }).pipe(Effect.provideService(CurrentSession, session(f)))).toMatchObject([{ id: tagId, name: "New name", slug: "new-name" }]);
    }));
    it.effect("assigns each feedback tag to a post once", () => Effect.gen(function* () {
      const handlers = yield* TagRpcHandlersEffect; const f = yield* fixture(); const tagId = yield* TagId.generate;
      yield* handlers.TagCreate({ id: tagId, name: "Feature", type: "FEEDBACK", organizationId: f.organizationId }).pipe(Effect.provideService(CurrentSession, session(f)));
      yield* handlers.PostTagSet({ organizationId: f.organizationId, postId: f.postId, tagIds: [tagId, tagId] }).pipe(Effect.provideService(CurrentSession, session(f)));
      expect(yield* handlers.PostTagList({ organizationId: f.organizationId }).pipe(Effect.provideService(CurrentSession, session(f)))).toMatchObject([{ postId: f.postId, tagId }]);
    }));
  });
});
