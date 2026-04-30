import { Effect, Layer } from "effect";
import * as Policy from "../policy";
import { InternalServerError } from "../rpc-errors";
import { CurrentSession } from "../session-middleware";
import { CommentReactionRepository } from "./repository";
import { CommentReactionRpcs } from "./rpcs";
import type { TCommentReactionList, TCommentReactionToggle } from "./schema";

export const CommentReactionRpcHandlers = CommentReactionRpcs.toLayer(
  Effect.gen(function* () {
    const repository = yield* CommentReactionRepository;
    // const sitePolicy = yield* SitePolicy;

    return {
      CommentReactionList: (args: TCommentReactionList) =>
        Effect.gen(function* () {
          //TODO: comeback later
          // yield* sitePolicy.canViewRoadmap(args.organizationId);
          return yield* repository.list({
            organizationId: args.organizationId,
            postId: args.postId,
          });
        }).pipe(
          Policy.withPolicy(Policy.hasMembership(args.organizationId)),
          Effect.catchTags({
            SqlError: () =>
              Effect.fail(
                new InternalServerError({
                  message: "Failed to list comment reactions",
                })
              ),
          })
        ),
      CommentReactionToggle: (args: TCommentReactionToggle) =>
        Effect.gen(function* () {
          const session = yield* CurrentSession;
          //TODO: comeback later
          // yield* sitePolicy.canViewRoadmap(args.organizationId);
          return yield* repository.toggle({
            organizationId: args.organizationId,
            postId: args.postId,
            commentId: args.commentId,
            userId: session.session.userId,
            emoji: args.emoji,
          });
        }).pipe(
          Policy.withPolicy(Policy.hasMembership(args.organizationId)),
          Effect.catchTags({
            SqlError: () =>
              Effect.fail(
                new InternalServerError({
                  message: "Failed to toggle comment reaction",
                })
              ),
          })
        ),
      CommentReactionListPublic: (args: TCommentReactionList) =>
        Effect.gen(function* () {
          //TODO: comeback later
          // yield* sitePolicy.canViewRoadmap(args.organizationId);
          return yield* repository.listPublic({
            organizationId: args.organizationId,
            postId: args.postId,
          });
        }).pipe(
          Effect.catchTags({
            SqlError: () =>
              Effect.fail(
                new InternalServerError({
                  message: "Failed to list comment reactions",
                })
              ),
          })
        ),
      CommentReactionTogglePublic: (args: TCommentReactionToggle) =>
        Effect.gen(function* () {
          const session = yield* CurrentSession;
          //TODO: comeback later
          // yield* sitePolicy.canViewRoadmap(args.organizationId);
          return yield* repository.togglePublic({
            organizationId: args.organizationId,
            postId: args.postId,
            commentId: args.commentId,
            userId: session.session.userId,
            emoji: args.emoji,
          });
        }).pipe(
          Effect.catchTags({
            SqlError: () =>
              Effect.fail(
                new InternalServerError({
                  message: "Failed to toggle comment reaction",
                })
              ),
          })
        ),
    };
  })
).pipe(
  // Layer.provide(SitePolicy.layer),
  Layer.provide(CommentReactionRepository.layer)
);
