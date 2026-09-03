import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as Policy from "../policy";
import * as RateLimit from "../rate-limit";
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
      // Statuses are org-public by design: the public portal renders every
      // post with its status label, so the status catalog must be readable
      // without a session (a member-only status list would leak nothing more
      // but would break the portal's rendering for anonymous visitors). The
      // endpoint is per-IP rate limited; no PII is returned (id/name/color/
      // kind only).
      repository
        .findMany({
          organizationId: args.organizationId,
        })
        .pipe(
          RateLimit.withPublicRpcRateLimit({
            name: "PostStatusListPublic",
            level: "read",
          }),
          withRemapDbErrors("PostStatus", "select")
        ),
  };
});

export const PostStatusRpcHandlers = PostStatusRpcs.toLayer(
  PostStatusRpcHandlersEffect
).pipe(
  // Layer.provide(SitePolicy.layer),
  Layer.provide(PostStatusRepository.layer)
);
