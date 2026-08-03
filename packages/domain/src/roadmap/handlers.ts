import { transaction } from "@feeblo/db";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { EntitlementPolicy } from "../entitlement/policies";
import * as Policy from "../policy";
import * as RateLimit from "../rate-limit";
import { withRemapDbErrors } from "../rpc-errors";
import { SitePolicy } from "../site/policies";
import { SiteRepository } from "../site/repository";
import { WorkspaceRepository } from "../workspace/repository";
import { RoadmapPolicy } from "./policies";
import { RoadmapRepository } from "./repository";
import { RoadmapRpcs } from "./rpcs";
import type {
  TRoadmapCreate,
  TRoadmapDelete,
  TRoadmapList,
  TRoadmapUpdate,
} from "./schema";

export const RoadmapRpcHandlersEffect = Effect.gen(function* () {
  const repository = yield* RoadmapRepository;
  const sitePolicy = yield* SitePolicy;
  const roadmapPolicy = yield* RoadmapPolicy;
  return {
    RoadmapList: (args: TRoadmapList) =>
      repository
        .findMany(args)
        .pipe(
          Policy.withPolicy(Policy.hasMembership(args.organizationId)),
          withRemapDbErrors("Roadmap", "select")
        ),
    RoadmapListPublic: (args: TRoadmapList) =>
      repository
        .findMany({ organizationId: args.organizationId, visibility: "public" })
        .pipe(
          RateLimit.withPublicRpcRateLimit({
            name: "RoadmapListPublic",
            level: "read",
          }),
          Policy.withPublicPolicy(
            sitePolicy.canViewRoadmap(args.organizationId)
          ),
          withRemapDbErrors("Roadmap", "select")
        ),
    RoadmapCreate: (args: TRoadmapCreate) =>
      transaction(
        Effect.gen(function* () {
          const roadmapCount = yield* repository.countByOrganizationId({
            organizationId: args.organizationId,
          });

          yield* repository.create({
            ...args,
            isPrimary: roadmapCount === 0,
          });
        })
      ).pipe(
        Policy.withPolicy(roadmapPolicy.canCreate(args)),
        withRemapDbErrors("Roadmap", "create")
      ),
    RoadmapUpdate: (args: TRoadmapUpdate) => {
      const { isPrimary: _isPrimary, ...updateArgs } = args;

      return transaction(repository.update(updateArgs)).pipe(
        Policy.withPolicy(
          roadmapPolicy.canUpdate({
            organizationId: args.organizationId,
            roadmapId: args.id,
            visibility: args.visibility,
          })
        ),
        withRemapDbErrors("Roadmap", "update")
      );
    },
    RoadmapDelete: (args: TRoadmapDelete) =>
      transaction(
        Effect.gen(function* () {
          const roadmap = yield* repository.getById({
            id: args.id,
            organizationId: args.organizationId,
          });

          yield* repository.delete(args);

          if (Option.isSome(roadmap) && roadmap.value.isPrimary) {
            yield* repository.delegatePrimary({
              organizationId: args.organizationId,
              exceptRoadmapId: args.id,
            });
          }
        })
      ).pipe(
        Policy.withPolicy(
          roadmapPolicy.canDelete({ organizationId: args.organizationId })
        ),
        withRemapDbErrors("Roadmap", "delete")
      ),
  };
});

export const RoadmapRpcHandlers = RoadmapRpcs.toLayer(
  RoadmapRpcHandlersEffect
).pipe(
  Layer.provide(SitePolicy.layer),
  Layer.provide(EntitlementPolicy.layer),
  Layer.provide(WorkspaceRepository.layer),
  Layer.provide(SiteRepository.layer),
  Layer.provide(RoadmapPolicy.layer),
  Layer.provide(RoadmapRepository.layer)
);
