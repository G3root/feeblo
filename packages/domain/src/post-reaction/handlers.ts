import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as Policy from "../policy";
import { PostPolicy } from "../post/policies";
import { PostRepository } from "../post/repository";
import { redactActorIdentities } from "../public-actor";
import * as RateLimit from "../rate-limit";
import { withRemapDbErrors } from "../rpc-errors";
import { CurrentSession, OptionalCurrentSession } from "../session-middleware";
import { PostReactionRepository } from "./repository";
import { PostReactionRpcs } from "./rpcs";
import type { TPostReactionList, TPostReactionToggle } from "./schema";

export const PostReactionRpcHandlersEffect = Effect.gen(function* () {
  const repository = yield* PostReactionRepository;
  const postPolicy = yield* PostPolicy;
  // const sitePolicy = yield* SitePolicy;

  return {
    PostReactionList: (args: TPostReactionList) =>
      repository
        .list({
          slug: args.slug,
          organizationId: args.organizationId,
        })
        .pipe(
          Policy.withPolicy(Policy.hasMembership(args.organizationId)),
          withRemapDbErrors("PostReaction", "select")
        ),
    PostReactionToggle: (args: TPostReactionToggle) =>
      Effect.gen(function* () {
        const session = yield* CurrentSession;
        //TODO: comeback later
        // yield* sitePolicy.canViewRoadmap(args.organizationId);

        return yield* repository.toggle({
          organizationId: args.organizationId,
          postId: args.postId,
          userId: session.session.userId,
          emoji: args.emoji,
        });
      }).pipe(
        Policy.withPolicy(
          Policy.all(
            Policy.hasMembership(args.organizationId),
            postPolicy.isUnlocked({
              organizationId: args.organizationId,
              postId: args.postId,
            })
          )
        ),
        withRemapDbErrors("PostReaction", "update")
      ),
    PostReactionListPublic: (args: TPostReactionList) =>
      Effect.gen(function* () {
        const sessionOption = yield* OptionalCurrentSession;
        const sessionUserId =
          sessionOption._tag === "Some"
            ? sessionOption.value.session.userId
            : undefined;

        const reactions = yield* repository.listPublic({
          slug: args.slug,
          organizationId: args.organizationId,
        });

        // Never leak internal reactor identifiers to public callers.
        return redactActorIdentities(reactions, sessionUserId);
      }).pipe(
        RateLimit.withPublicRpcRateLimit({
          name: "PostReactionListPublic",
          level: "read",
        }),
        withRemapDbErrors("PostReaction", "select")
      ),
    PostReactionTogglePublic: (args: TPostReactionToggle) =>
      Effect.gen(function* () {
        const session = yield* CurrentSession;
        //TODO: comeback later
        // yield* sitePolicy.canViewRoadmap(args.organizationId);

        return yield* repository.togglePublic({
          organizationId: args.organizationId,
          postId: args.postId,
          userId: session.session.userId,
          emoji: args.emoji,
        });
      }).pipe(
        RateLimit.withPublicRpcRateLimit({
          name: "PostReactionTogglePublic",
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
        withRemapDbErrors("PostReaction", "update")
      ),
  };
});

export const PostReactionRpcHandlers = PostReactionRpcs.toLayer(
  PostReactionRpcHandlersEffect
).pipe(
  // Layer.provide(SitePolicy.layer),
  Layer.provide(PostPolicy.layer),
  Layer.provide(PostRepository.layer),
  Layer.provide(PostReactionRepository.layer)
);
