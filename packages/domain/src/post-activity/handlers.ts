import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as Policy from "../policy";
import { withRemapDbErrors } from "../rpc-errors";
import { PostActivityRepository } from "./repository";
import { PostActivityRpcs } from "./rpcs";
import type { TPostActivityList } from "./schema";

export const PostActivityRpcHandlersEffect = Effect.gen(function* () {
  const repository = yield* PostActivityRepository;

  return {
    PostActivityList: (args: TPostActivityList) =>
      repository
        .findMany({
          organizationId: args.organizationId,
          postId: args.postId,
          ...(args.since === undefined ? undefined : { since: args.since }),
        })
        .pipe(
          Policy.withPolicy(Policy.hasMembership(args.organizationId)),
          withRemapDbErrors("PostActivity", "select")
        ),
  };
});

export const PostActivityRpcHandlers = PostActivityRpcs.toLayer(
  PostActivityRpcHandlersEffect
).pipe(Layer.provide(PostActivityRepository.layer));
