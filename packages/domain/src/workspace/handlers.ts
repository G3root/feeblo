import { Effect, Layer } from "effect";
import * as Policy from "../policy";
import { onInternalServerError } from "../rpc-errors";
import { WorkspaceRepository } from "./repository";
import { WorkspaceRpcs } from "./rpcs";
import type { TWorkspaceInput } from "./schema";

export const WorkspaceRpcHandlers = WorkspaceRpcs.toLayer(
  Effect.gen(function* () {
    const repository = yield* WorkspaceRepository;

    return {
      WorkspaceProductList: () =>
        repository.findProducts().pipe(Effect.catchAll(onInternalServerError)),
      WorkspaceSubscriptionGet: (args: TWorkspaceInput) =>
        repository
          .findSubscriptionByOrganizationId({
            organizationId: args.organizationId,
          })
          .pipe(
            Policy.withPolicy(Policy.hasMembership(args.organizationId)),
            Effect.catchAll(onInternalServerError)
          ),
    };
  })
).pipe(Layer.provide(WorkspaceRepository.Default));
