import { Effect, Layer } from "effect";
import * as Policy from "../policy";
import { InternalServerError } from "../rpc-errors";
import { PostStatusRepository } from "./repository";
import { PostStatusRpcs } from "./rpcs";
import type { TPostStatusList } from "./schema";

export const PostStatusRpcHandlers = PostStatusRpcs.toLayer(
  Effect.gen(function* () {
    const repository = yield* PostStatusRepository;

    return {
      PostStatusList: (args: TPostStatusList) =>
        repository
          .findMany({
            organizationId: args.organizationId,
          })
          .pipe(
            Policy.withPolicy(Policy.hasMembership(args.organizationId)),
            Effect.catchTags({
              SqlError: () =>
                Effect.fail(
                  new InternalServerError({
                    message: "Failed to list post statuses",
                  })
                ),
            })
          ),
      PostStatusListPublic: (args: TPostStatusList) =>
        repository
          .findMany({
            organizationId: args.organizationId,
          })
          .pipe(
            Effect.catchTags({
              SqlError: () =>
                Effect.fail(
                  new InternalServerError({
                    message: "Failed to list post statuses",
                  })
                ),
            })
          ),
    };
  })
).pipe(Layer.provide(PostStatusRepository.Default));
