import { describe, expect, layer } from "@effect/vitest";
import { currentDb, Database, schema } from "@feeblo/db";
import {
  BoardId,
  CommentId,
  type LegidOf,
  PostId,
  PostStatusId,
  WorkspaceId,
} from "@feeblo/id";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { PostPolicy } from "../post/policies";
import { PostRepository } from "../post/repository";
import {
  CurrentSession,
  OptionalCurrentSession,
  type Session,
} from "../session-middleware";
import { CommentReactionRpcHandlersEffect } from "./handlers";
import { CommentReactionRepository } from "./repository";

describe("CommentReactionRpcHandlers", () => {
  type Fixture = {
    commentId: LegidOf<"CommentId">;
    membershipId: string;
    organizationId: LegidOf<"WorkspaceId">;
    postId: LegidOf<"PostId">;
    postSlug: string;
    userId: string;
  };
  const session = (f: Fixture, member = true): Session => ({
    user: {
      id: f.userId,
      email: "user@example.com",
      name: "User",
      restrictedToOrganizationId: null,
    },
    session: { userId: f.userId, token: "token" },
    organizations: [{ id: f.organizationId }],
    memberships: member
      ? [
          {
            membershipId: f.membershipId,
            organizationId: f.organizationId,
            role: "owner",
          },
        ]
      : [],
  });
  const fixture = (
    visibility: "PUBLIC" | "PRIVATE" = "PUBLIC",
    commentVisibility: "PUBLIC" | "INTERNAL" = "PUBLIC"
  ) =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      const organizationId = yield* WorkspaceId.generate;
      const boardId = yield* BoardId.generate;
      const postId = yield* PostId.generate;
      const postSlug = `slug-${postId}`;
      const commentId = yield* CommentId.generate;
      const statusId = yield* PostStatusId.generate;
      const userId = `user_${organizationId}`;
      const membershipId = `member_${organizationId}`;
      const now = new Date();
      yield* db.insert(schema.organizationTable).values({
        id: organizationId,
        name: "Organization",
        slug: organizationId,
        createdAt: now,
      });
      yield* db.insert(schema.userTable).values({
        id: userId,
        email: `${organizationId}@example.com`,
        name: "User",
      });
      yield* db.insert(schema.memberTable).values({
        id: membershipId,
        organizationId,
        userId,
        role: "owner",
        createdAt: now,
      });
      yield* db.insert(schema.boardTable).values({
        id: boardId,
        name: "Board",
        slug: boardId,
        visibility,
        organizationId,
        creatorId: userId,
        creatorMemberId: membershipId,
        createdAt: now,
        updatedAt: now,
      });
      yield* db.insert(schema.postStatusTable).values({
        id: statusId,
        type: "PENDING",
        orderIndex: 0,
        organizationId,
      });
      yield* db.insert(schema.postTable).values({
        id: postId,
        title: "Post",
        content: "Content",
        slug: postSlug,
        excerpt: "Content",
        boardId,
        organizationId,
        statusId,
        creatorId: userId,
        creatorMemberId: membershipId,
        createdAt: now,
        updatedAt: now,
      });
      yield* db.insert(schema.commentTable).values({
        id: commentId,
        content: "Comment",
        organizationId,
        postId,
        userId,
        memberId: membershipId,
        visibility: commentVisibility,
        createdAt: now,
        updatedAt: now,
        parentCommentId: null,
      });
      return {
        commentId,
        membershipId,
        organizationId,
        postId,
        postSlug,
        userId,
      } satisfies Fixture;
    });
  const Repositories = Layer.mergeAll(
    PostRepository.layer,
    CommentReactionRepository.layer
  ).pipe(Layer.provide(Database.PgliteDatabaseLive));
  const TestLayer = PostPolicy.layer.pipe(Layer.provideMerge(Repositories));

  layer(Layer.merge(TestLayer, Database.PgliteDatabaseLive))(
    "handlers",
    (it) => {
      it.effect("does not list reactions for users without a membership", () =>
        Effect.gen(function* () {
          const handlers = yield* CommentReactionRpcHandlersEffect;
          const f = yield* fixture();
          const error = yield* Effect.flip(
            handlers
              .CommentReactionList({
                organizationId: f.organizationId,
                slug: f.postSlug,
              })
              .pipe(Effect.provideService(CurrentSession, session(f, false)))
          );
          expect(error._tag).toBe("PolicyDenied");
        })
      );
      it.effect("toggles a member reaction on a comment", () =>
        Effect.gen(function* () {
          const handlers = yield* CommentReactionRpcHandlersEffect;
          const f = yield* fixture();
          const input = {
            organizationId: f.organizationId,
            postId: f.postId,
            commentId: f.commentId,
            emoji: "rocket" as const,
          };
          expect(
            yield* handlers
              .CommentReactionToggle(input)
              .pipe(Effect.provideService(CurrentSession, session(f)))
          ).toEqual({ reacted: true, emoji: "rocket" });
          const reactions = yield* handlers
            .CommentReactionList({
              organizationId: f.organizationId,
              slug: f.postSlug,
            })
            .pipe(Effect.provideService(CurrentSession, session(f)));
          expect(reactions).toHaveLength(1);
          expect(reactions[0]).toMatchObject({
            commentId: f.commentId,
            userId: f.userId,
            memberId: f.membershipId,
            emoji: "rocket",
          });
        })
      );
      it.effect(
        "does not react to comments on private boards through the public endpoint",
        () =>
          Effect.gen(function* () {
            const handlers = yield* CommentReactionRpcHandlersEffect;
            const f = yield* fixture("PRIVATE");
            const error = yield* Effect.flip(
              handlers
                .CommentReactionTogglePublic({
                  organizationId: f.organizationId,
                  postId: f.postId,
                  commentId: f.commentId,
                  emoji: "fire",
                })
                .pipe(Effect.provideService(CurrentSession, session(f, false)))
            );
            expect(error._tag).toBe("PolicyDenied");
          })
      );
      it.effect("redacts reactor identity on the public list", () =>
        Effect.gen(function* () {
          const handlers = yield* CommentReactionRpcHandlersEffect;
          const f = yield* fixture();
          const input = {
            organizationId: f.organizationId,
            postId: f.postId,
            commentId: f.commentId,
            emoji: "rocket" as const,
          };
          yield* handlers
            .CommentReactionToggle(input)
            .pipe(Effect.provideService(CurrentSession, session(f)));

          const anonymous = yield* handlers
            .CommentReactionListPublic({
              organizationId: f.organizationId,
              slug: f.postSlug,
            })
            .pipe(Effect.provideService(OptionalCurrentSession, Option.none()));
          expect(anonymous).toHaveLength(1);
          expect(anonymous[0]).toMatchObject({
            commentId: f.commentId,
            userId: null,
            memberId: null,
            emoji: "rocket",
          });

          const own = yield* handlers
            .CommentReactionListPublic({
              organizationId: f.organizationId,
              slug: f.postSlug,
            })
            .pipe(
              Effect.provideService(
                OptionalCurrentSession,
                Option.some(session(f))
              )
            );
          expect(own[0]).toMatchObject({
            commentId: f.commentId,
            userId: f.userId,
            memberId: f.membershipId,
            emoji: "rocket",
          });

          // An authenticated caller who is not the reactor sees the reactor's
          // identifiers redacted, same as an anonymous caller.
          const otherUserId = `other_user_${f.organizationId}`;
          const otherSession: Session = {
            user: {
              id: otherUserId,
              email: `${otherUserId}@example.com`,
              name: "Other User",
              restrictedToOrganizationId: null,
            },
            session: { userId: otherUserId, token: "other-token" },
            organizations: [{ id: f.organizationId }],
            memberships: [],
          };
          const other = yield* handlers
            .CommentReactionListPublic({
              organizationId: f.organizationId,
              slug: f.postSlug,
            })
            .pipe(
              Effect.provideService(
                OptionalCurrentSession,
                Option.some(otherSession)
              )
            );
          expect(other).toHaveLength(1);
          expect(other[0]).toMatchObject({
            commentId: f.commentId,
            userId: null,
            memberId: null,
            emoji: "rocket",
          });
        })
      );
      it.effect(
        "hides reactions on internal comments from the public endpoint",
        () =>
          Effect.gen(function* () {
            const handlers = yield* CommentReactionRpcHandlersEffect;
            const f = yield* fixture("PUBLIC", "INTERNAL");
            const input = {
              organizationId: f.organizationId,
              postId: f.postId,
              commentId: f.commentId,
            };
            yield* handlers
              .CommentReactionToggle({ ...input, emoji: "thumbs_up" })
              .pipe(Effect.provideService(CurrentSession, session(f)));
            const reactions = yield* handlers
              .CommentReactionListPublic({
                organizationId: f.organizationId,
                slug: f.postSlug,
              })
              .pipe(
                Effect.provideService(OptionalCurrentSession, Option.none())
              );
            expect(reactions).toHaveLength(0);
            expect(
              yield* handlers
                .CommentReactionTogglePublic({ ...input, emoji: "fire" })
                .pipe(Effect.provideService(CurrentSession, session(f, false)))
            ).toEqual({ reacted: false, emoji: null });
          })
      );
    }
  );
});
