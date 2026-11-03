import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { PostPolicy } from "../post/policies";
import { PostRepository } from "../post/repository";
import { makeReactionRpcHandlers } from "../reaction/handlers";
import type { ReactionList } from "../reaction/schema";
import type { RpcTagsOf } from "../rpc-group";
import { CommentReactionRepository } from "./repository";
import { CommentReactionRpcs } from "./rpcs";
import type { TCommentReactionToggle } from "./schema";

/** The RPCs this group declares; a surface pair's operation must be one. */
type CommentReactionRpcTag = RpcTagsOf<typeof CommentReactionRpcs>;

/**
 * Comment reactions over the shared reaction family.
 *
 * The four handlers, the two surfaces' policies and limiters, the public
 * redaction, and the db-error remap come from `reaction/handlers.ts`; this file
 * is the comment naming of that record onto `CommentReactionRpcs`. The
 * repository is what makes a comment reaction its own target: it joins through
 * the comment to the post, and it lists the reactions of comments merged away
 * from the requested post under that post too.
 */
export const CommentReactionRpcHandlersEffect = Effect.gen(function* () {
  const repository = yield* CommentReactionRepository;
  const handlers = yield* makeReactionRpcHandlers<
    CommentReactionRpcTag,
    ReactionList,
    TCommentReactionToggle
  >()({
    entity: "CommentReaction",
    listOperation: "ListCommentReactions",
    service: repository,
    toggleOperation: "ToggleCommentReaction",
  });

  return {
    ListCommentReactions: handlers.list,
    ListCommentReactionsPublic: handlers.listPublic,
    ToggleCommentReaction: handlers.toggle,
    ToggleCommentReactionPublic: handlers.togglePublic,
  };
});

export const CommentReactionRpcHandlers = CommentReactionRpcs.toLayer(
  CommentReactionRpcHandlersEffect
).pipe(
  Layer.provide(PostPolicy.layer),
  Layer.provide(PostRepository.layer),
  Layer.provide(CommentReactionRepository.layer)
);
