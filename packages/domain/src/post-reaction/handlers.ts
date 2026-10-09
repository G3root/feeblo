import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as Policy from "../policy";
import { PostPolicy } from "../post/policies";
import { PostRepository } from "../post/repository";
import { redactActorIdentities } from "../public-actor";
import * as RateLimit from "../rate-limit";
import { withRemapDbErrors } from "../rpc-errors";
import type { RpcTagsOf } from "../rpc-group";
import { CurrentSession, OptionalCurrentSession } from "../session-middleware";
import {
  type Surface,
  type SurfacePair,
  withSurfaceRateLimit,
} from "../surface";
import { PostReactionRepository } from "./repository";
import { PostReactionRpcs } from "./rpcs";
import type { TPostReactionList, TPostReactionToggle } from "./schema";

/** The RPCs this group declares; a surface pair's operation must be one. */
type PostReactionRpcTag = RpcTagsOf<typeof PostReactionRpcs>;

export const PostReactionRpcHandlersEffect = Effect.gen(function* () {
  const repository = yield* PostReactionRepository;
  const postPolicy = yield* PostPolicy;
  // const sitePolicy = yield* SitePolicy;

  // -- Surface-parameterized writes --
  //
  // The two surfaces read different projections: the dashboard checks
  // `isUnlocked` in its policy and toggles directly, the public portal checks
  // `isUnlockedPublic` and lets the repository's `togglePublic` join the
  // board visibility.

  const toggleWrite = {
    operation: "PostReactionToggle",
    dashboard: {
      rateLimit: undefined,
      policy: (args: TPostReactionToggle) =>
        Policy.all(
          Policy.hasMembership(args.organizationId),
          postPolicy.isUnlocked({
            organizationId: args.organizationId,
            postId: args.postId,
          })
        ),
    },
    public: {
      rateLimit: "write",
      policy: (args: TPostReactionToggle) =>
        Policy.all(
          Policy.hasRestrictedOrganizationScope(args.organizationId),
          postPolicy.isUnlockedPublic({
            organizationId: args.organizationId,
            postId: args.postId,
          })
        ),
    },
  } satisfies SurfacePair<TPostReactionToggle, PostReactionRpcTag>;

  const toggleReaction = <
    Level extends RateLimit.PublicRpcRateLimitLevel | undefined,
  >(
    surface: Surface,
    level: Level,
    args: TPostReactionToggle
  ) =>
    Effect.gen(function* () {
      const session = yield* CurrentSession;
      const request = {
        emoji: args.emoji,
        organizationId: args.organizationId,
        postId: args.postId,
        userId: session.session.userId,
      };

      return yield* surface === "public"
        ? repository.togglePublic(request)
        : repository.toggle(request);
    }).pipe(
      Policy.withPolicy(toggleWrite[surface].policy(args)),
      withRemapDbErrors("PostReaction", "update"),
      withSurfaceRateLimit({
        level,
        operation: toggleWrite.operation,
        surface,
      })
    );

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
      toggleReaction("dashboard", toggleWrite.dashboard.rateLimit, args),
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
      toggleReaction("public", toggleWrite.public.rateLimit, args),
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
