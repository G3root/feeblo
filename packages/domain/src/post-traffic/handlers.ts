import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import * as Policy from "../policy";
import { PostNotFoundError } from "../post/errors";
import { withRemapDbErrors } from "../rpc-errors";
import { PostTrafficRepository } from "./repository";
import { PostTrafficRpcs } from "./rpcs";
import type { TPostTrafficPayload } from "./schema";

/**
 * The breakdown window. The all-time number is the counter; this is how far
 * back the "from where" answer goes.
 */
const TRAFFIC_WINDOW_DAYS = 30;

export const PostTrafficRpcHandlersEffect = Effect.gen(function* () {
  const repository = yield* PostTrafficRepository;

  return {
    GetPostViewCount: (args: TPostTrafficPayload) =>
      Effect.gen(function* () {
        const views = yield* repository.getPostViewCount({
          organizationId: args.organizationId,
          postId: args.postId,
        });

        if (Option.isNone(views)) {
          return yield* new PostNotFoundError({ message: "Post not found" });
        }

        return { postId: args.postId, views: views.value };
      }).pipe(
        Policy.withPolicy(Policy.hasMembership(args.organizationId)),
        withRemapDbErrors("PostTraffic", "select")
      ),
    GetPostTraffic: (args: TPostTrafficPayload) =>
      Effect.gen(function* () {
        const now = yield* DateTime.now;
        const since = DateTime.toDate(
          DateTime.subtract({ days: TRAFFIC_WINDOW_DAYS })(now)
        );

        const traffic = yield* repository.getPostTraffic({
          organizationId: args.organizationId,
          postId: args.postId,
          since,
        });

        if (Option.isNone(traffic)) {
          return yield* new PostNotFoundError({ message: "Post not found" });
        }

        return traffic.value;
      }).pipe(
        Policy.withPolicy(Policy.hasMembership(args.organizationId)),
        withRemapDbErrors("PostTraffic", "select")
      ),
  };
});

export const PostTrafficRpcHandlers = PostTrafficRpcs.toLayer(
  PostTrafficRpcHandlersEffect
);
