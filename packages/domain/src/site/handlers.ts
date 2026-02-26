import { Effect, Layer } from "effect";
import { requireOrganizationMembership } from "../authorization";
import { mapToInternalServerError, UnauthorizedError } from "../rpc-errors";
import { SiteRepository } from "./repository";
import { SiteRpcs } from "./rpcs";
import type { TSiteList } from "./schema";

export const SiteRpcHandlers = SiteRpcs.toLayer(
  Effect.gen(function* () {
    const repository = yield* SiteRepository;

    return {
      SiteList: (args: TSiteList) => {
        return Effect.gen(function* () {
          yield* requireOrganizationMembership(args.organizationId);
          return yield* repository.findMany({
            organizationId: args.organizationId,
          });
        }).pipe(Effect.mapError(mapToInternalServerError(UnauthorizedError)));
      },
    };
  })
).pipe(Layer.provide(SiteRepository.Default));
