import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as Policy from "../policy";
import { withRemapDbErrors } from "../rpc-errors";
import { PostStatusRepository } from "./repository";
import { PostStatusRpcs } from "./rpcs";
import type { TPostStatusList } from "./schema";

export const PostStatusRpcHandlersEffect = Effect.gen(function* () {
  const repository = yield* PostStatusRepository;
  // const sitePolicy = yield* SitePolicy;

  return {
    PostStatusList: (args: TPostStatusList) =>
      repository
        .findMany({
          organizationId: args.organizationId,
        })
        .pipe(
          Policy.withPolicy(Policy.hasMembership(args.organizationId)),
          withRemapDbErrors("PostStatus", "select")
        ),
    PostStatusListPublic: (args: TPostStatusList) =>
      repository
        .findMany({
          organizationId: args.organizationId,
        })
        .pipe(withRemapDbErrors("PostStatus", "select")),
  };
});

export const PostStatusRpcHandlers = PostStatusRpcs.toLayer(
  PostStatusRpcHandlersEffect
).pipe(
  // Layer.provide(SitePolicy.layer),
  Layer.provide(PostStatusRepository.layer)
);
