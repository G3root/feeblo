import { Effect, Layer } from "effect";
import * as Policy from "../policy";
import { PostPolicy } from "../post/policies";
import { PostRepository } from "../post/repository";
import { withRemapDbErrors } from "../rpc-errors";
import { CurrentSession } from "../session-middleware";
import { CommentReactionRepository } from "./repository";
import { CommentReactionRpcs } from "./rpcs";
import type { TCommentReactionList, TCommentReactionToggle } from "./schema";

export const CommentReactionRpcHandlers = CommentReactionRpcs.toLayer(
  Effect.gen(function* () {
    const repository = yield* CommentReactionRepository;
    const postPolicy = yield* PostPolicy;
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
          withRemapDbErrors("CommentReaction", "select")
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
          Policy.withPolicy(
            Policy.all(
              postPolicy.isUnlocked({
                organizationId: args.organizationId,
                postId: args.postId,
              }),
              Policy.hasMembership(args.organizationId)
            )
          ),
          withRemapDbErrors("CommentReaction", "update")
        ),
      CommentReactionListPublic: (args: TCommentReactionList) =>
        Effect.gen(function* () {
          //TODO: comeback later
          // yield* sitePolicy.canViewRoadmap(args.organizationId);
          return yield* repository.listPublic({
            organizationId: args.organizationId,
            postId: args.postId,
          });
        }).pipe(withRemapDbErrors("CommentReaction", "select")),
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
          Policy.withPublicPolicy(
            postPolicy.isUnlockedPublic({
              organizationId: args.organizationId,
              postId: args.postId,
            })
          ),
          withRemapDbErrors("CommentReaction", "update")
        ),
    };
  })
).pipe(
  // Layer.provide(SitePolicy.layer),
  Layer.provide(PostPolicy.layer),
  Layer.provide(PostRepository.layer),
  Layer.provide(CommentReactionRepository.layer)
);
