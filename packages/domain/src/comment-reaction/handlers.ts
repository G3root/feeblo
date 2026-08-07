import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as Policy from "../policy";
import { PostPolicy } from "../post/policies";
import { PostRepository } from "../post/repository";
import { redactActorIdentities } from "../public-actor";
import * as RateLimit from "../rate-limit";
import { withRemapDbErrors } from "../rpc-errors";
import { CurrentSession, OptionalCurrentSession } from "../session-middleware";
import { CommentReactionRepository } from "./repository";
import { CommentReactionRpcs } from "./rpcs";
import type { TCommentReactionList, TCommentReactionToggle } from "./schema";

export const CommentReactionRpcHandlersEffect = Effect.gen(function* () {
  const repository = yield* CommentReactionRepository;
  const postPolicy = yield* PostPolicy;
  // const sitePolicy = yield* SitePolicy;

  return {
    CommentReactionList: (args: TCommentReactionList) =>
      repository
        .list({
          organizationId: args.organizationId,
          slug: args.slug,
        })
        .pipe(
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
        const sessionOption = yield* OptionalCurrentSession;
        const sessionUserId =
          sessionOption._tag === "Some"
            ? sessionOption.value.session.userId
            : undefined;

        const reactions = yield* repository.listPublic({
          organizationId: args.organizationId,
          slug: args.slug,
        });

        // Never leak internal reactor identifiers to public callers.
        return redactActorIdentities(reactions, sessionUserId);
      }).pipe(
        RateLimit.withPublicRpcRateLimit({
          name: "CommentReactionListPublic",
          level: "read",
        }),
        withRemapDbErrors("CommentReaction", "select")
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
        RateLimit.withPublicRpcRateLimit({
          name: "CommentReactionTogglePublic",
          level: "write",
        }),
        Policy.withPolicy(
          Policy.all(
            Policy.hasRestrictedOrganizationScope(args.organizationId),
            postPolicy.isUnlockedPublic({
              organizationId: args.organizationId,
              postId: args.postId,
            })
          )
        ),
        withRemapDbErrors("CommentReaction", "update")
      ),
  };
});

export const CommentReactionRpcHandlers = CommentReactionRpcs.toLayer(
  CommentReactionRpcHandlersEffect
).pipe(
  // Layer.provide(SitePolicy.layer),
  Layer.provide(PostPolicy.layer),
  Layer.provide(PostRepository.layer),
  Layer.provide(CommentReactionRepository.layer)
);
