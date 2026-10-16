import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as Policy from "../policy";
import { PostPolicy } from "../post/policies";
import { PostRepository } from "../post/repository";
import { redactActorIdentities } from "../public-actor";
import { withPublicViewer } from "../public-read";
import { withRemapDbErrors } from "../rpc-errors";
import type { RpcTagsOf } from "../rpc-group";
import { CurrentSession } from "../session-middleware";
import { definePublicEntry, defineSurfacePair } from "../surface";
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

  const toggleWrite = defineSurfacePair<
    TCommentReactionToggle,
    CommentReactionRpcTag
  >()({
    operation: "ToggleCommentReaction",
    remap: { action: "update", entity: "CommentReaction" },
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
  });

  // The dashboard list projects from the repository's internal predicate; the
  // public list projects its own, so the pair does not apply and the
  // dashboard half stays hand-written.
  const listPublicEntry = definePublicEntry<
    TCommentReactionList,
    CommentReactionRpcTag
  >()({
    operation: "ListCommentReactions",
    remap: { action: "select", entity: "CommentReaction" },
    config: { rateLimit: "read", policy: () => Policy.allow },
  });

  const toggleReaction = toggleWrite.handlers((surface, args) =>
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
    })
  );

  return {
    ListCommentReactions: (args: TCommentReactionList) =>
      repository
        .list({
          organizationId: args.organizationId,
          slug: args.slug,
        })
        .pipe(
          Policy.withPolicy(Policy.hasMembership(args.organizationId)),
          withRemapDbErrors("CommentReaction", "select")
        ),
    ToggleCommentReaction: toggleReaction.dashboard,
    ListCommentReactionsPublic: listPublicEntry.entry((args) =>
      withPublicViewer({
        read: () =>
          repository.listPublic({
            organizationId: args.organizationId,
            slug: args.slug,
          }),
        redact: redactActorIdentities,
      })
    ),
    ToggleCommentReactionPublic: toggleReaction.public,
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
