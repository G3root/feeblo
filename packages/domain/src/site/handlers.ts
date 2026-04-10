import { Effect, Layer } from "effect";
import * as Policy from "../policy";
import { InternalServerError } from "../rpc-errors";
import { SiteRepository } from "./repository";
import { SiteRpcs } from "./rpcs";
import type { TSiteList, TSiteListBySubdomain, TSiteUpdate } from "./schema";

export const SiteRpcHandlers = SiteRpcs.toLayer(
  Effect.gen(function* () {
    const repository = yield* SiteRepository;

    return {
      SiteList: (args: TSiteList) =>
        repository
          .findMany({
            organizationId: args.organizationId,
            limit: 1,
          })
          .pipe(
            Policy.withPolicy(Policy.hasMembership(args.organizationId)),
            Effect.catchTags({
              SqlError: () =>
                Effect.fail(
                  new InternalServerError({
                    message: "Failed to list Sites",
                  })
                ),
            })
          ),
      SiteListBySubdomain: (args: TSiteListBySubdomain) =>
        repository
          .findMany({
            subdomain: args.subdomain,
            limit: 1,
          })
          .pipe(
            Effect.catchTags({
              SqlError: () =>
                Effect.fail(
                  new InternalServerError({
                    message: "Failed to list Sites by subdomain",
                  })
                ),
            })
          ),
      SiteUpdate: (args: TSiteUpdate) =>
        repository.update(args).pipe(
          Policy.withPolicy(
            Policy.all(
              Policy.hasMembership(args.organizationId),
              Policy.any(Policy.hasRole("owner"), Policy.hasRole("admin"))
            )
          ),
          Effect.catchTags({
            SqlError: () =>
              Effect.fail(
                new InternalServerError({
                  message: "Failed to update Site",
                })
              ),
          })
        ),
    };
  })
).pipe(Layer.provide(SiteRepository.layer));
