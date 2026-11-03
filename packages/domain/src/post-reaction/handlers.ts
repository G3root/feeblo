import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { PostPolicy } from "../post/policies";
import { PostRepository } from "../post/repository";
import { makeReactionRpcHandlers } from "../reaction/handlers";
import type { ReactionList } from "../reaction/schema";
import type { RpcTagsOf } from "../rpc-group";
import { PostReactionRepository } from "./repository";
import { PostReactionRpcs } from "./rpcs";
import type { TPostReactionToggle } from "./schema";

/** The RPCs this group declares; a surface pair's operation must be one. */
type PostReactionRpcTag = RpcTagsOf<typeof PostReactionRpcs>;

/**
 * Post reactions over the shared reaction family.
 *
 * The four handlers, the two surfaces' policies and limiters, the public
 * redaction, and the db-error remap come from `reaction/handlers.ts`; this file
 * is the post naming of that record onto `PostReactionRpcs`. A reaction target
 * differs in its repository — which table, which visibility joins, which
 * merged-content rule — not in how it is authorized.
 */
export const PostReactionRpcHandlersEffect = Effect.gen(function* () {
  const repository = yield* PostReactionRepository;
  const handlers = yield* makeReactionRpcHandlers<
    PostReactionRpcTag,
    ReactionList,
    TPostReactionToggle
  >()({
    entity: "PostReaction",
    listOperation: "ListPostReactions",
    service: repository,
    toggleOperation: "TogglePostReaction",
  });

  return {
    ListPostReactions: handlers.list,
    ListPostReactionsPublic: handlers.listPublic,
    TogglePostReaction: handlers.toggle,
    TogglePostReactionPublic: handlers.togglePublic,
  };
});

export const PostReactionRpcHandlers = PostReactionRpcs.toLayer(
  PostReactionRpcHandlersEffect
).pipe(
  Layer.provide(PostPolicy.layer),
  Layer.provide(PostRepository.layer),
  Layer.provide(PostReactionRepository.layer)
);
