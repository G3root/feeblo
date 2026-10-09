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
import { CommentReactionRepository } from "./repository";
import { CommentReactionRpcs } from "./rpcs";
import type { TCommentReactionList, TCommentReactionToggle } from "./schema";

/** The RPCs this group declares; a surface pair's operation must be one. */
type CommentReactionRpcTag = RpcTagsOf<typeof CommentReactionRpcs>;

export const CommentReactionRpcHandlersEffect = Effect.gen(function* () {
  const repository = yield* CommentReactionRepository;
  const postPolicy = yield* PostPolicy;
  // const sitePolicy = yield* SitePolicy;

  // -- Surface-parameterized writes --
  //
  // The two surfaces read different projections: the dashboard checks
  // `isUnlocked` in its policy and toggles directly, the public portal checks
  // `isUnlockedPublic` and lets the repository's `togglePublic` join the
  // board visibility.

  const toggleWrite = {
    operation: "CommentReactionToggle",
    dashboard: {
      rateLimit: undefined,
      policy: (args: TCommentReactionToggle) =>
        Policy.all(
          postPolicy.isUnlocked({
            organizationId: args.organizationId,
            postId: args.postId,
          }),
          Policy.hasMembership(args.organizationId)
        ),
    },
    public: {
      rateLimit: "write",
      policy: (args: TCommentReactionToggle) =>
        Policy.all(
          Policy.hasRestrictedOrganizationScope(args.organizationId),
          postPolicy.isUnlockedPublic({
            organizationId: args.organizationId,
            postId: args.postId,
          })
        ),
    },
  } satisfies SurfacePair<TCommentReactionToggle, CommentReactionRpcTag>;

  const toggleReaction = <
    Level extends RateLimit.PublicRpcRateLimitLevel | undefined,
  >(
    surface: Surface,
    level: Level,
    args: TCommentReactionToggle
  ) =>
    Effect.gen(function* () {
      const session = yield* CurrentSession;
      const request = {
        commentId: args.commentId,
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
      withRemapDbErrors("CommentReaction", "update"),
      withSurfaceRateLimit({
        level,
        operation: toggleWrite.operation,
        surface,
      })
    );

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
      toggleReaction("dashboard", toggleWrite.dashboard.rateLimit, args),
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
      toggleReaction("public", toggleWrite.public.rateLimit, args),
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
