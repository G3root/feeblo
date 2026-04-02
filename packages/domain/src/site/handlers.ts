import { Effect, Layer } from "effect";
import * as Policy from "../policy";
import { onInternalServerError } from "../rpc-errors";
import { SiteRepository } from "./repository";
import { SiteRpcs } from "./rpcs";
import type { TSiteList, TSiteListBySubdomain, TSiteUpdate } from "./schema";

export const SiteRpcHandlers = SiteRpcs.toLayer(
  Effect.gen(function* () {
    const repository = yield* SiteRepository;

    return {
      SiteList: (args: TSiteList) => {
        return Effect.gen(function* () {
          return yield* repository.findMany({
            organizationId: args.organizationId,
            limit: 1,
          });
        }).pipe(
          Policy.withPolicy(Policy.hasMembership(args.organizationId)),
          Effect.catchAll(onInternalServerError)
        );
      },
      SiteListBySubdomain: (args: TSiteListBySubdomain) => {
        return Effect.gen(function* () {
          return yield* repository.findMany({
            subdomain: args.subdomain,
            limit: 1,
          });
        }).pipe(Effect.catchAll(onInternalServerError));
      },
      SiteUpdate: (args: TSiteUpdate) => {
        return Effect.gen(function* () {
          yield* repository.update(args);
        }).pipe(
          Policy.withPolicy(
            Policy.all(
              Policy.hasMembership(args.organizationId),
              Policy.any(Policy.hasRole("owner"), Policy.hasRole("admin"))
            )
          ),
          Effect.catchAll(onInternalServerError)
        );
      },
    };
  })
).pipe(Layer.provide(SiteRepository.Default));
