import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Policy from "../policy";
import * as RateLimit from "../rate-limit";
import { withRemapDbErrors } from "../rpc-errors";
import { SitePolicy } from "../site/policies";
import { SiteRepository } from "../site/repository";
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
  const manage = (organizationId: string) =>
    Policy.hasOrganizationOwnerOrAdmin(organizationId);
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
      repository
        .create(args)
        .pipe(
          Policy.withPolicy(manage(args.organizationId)),
          withRemapDbErrors("Roadmap", "create")
        ),
    RoadmapUpdate: (args: TRoadmapUpdate) =>
      repository
        .update(args)
        .pipe(
          Policy.withPolicy(manage(args.organizationId)),
          withRemapDbErrors("Roadmap", "update")
        ),
    RoadmapDelete: (args: TRoadmapDelete) =>
      repository
        .delete(args)
        .pipe(
          Policy.withPolicy(manage(args.organizationId)),
          withRemapDbErrors("Roadmap", "delete")
        ),
  };
});

export const RoadmapRpcHandlers = RoadmapRpcs.toLayer(
  RoadmapRpcHandlersEffect
).pipe(
  Layer.provide(SitePolicy.layer),
  Layer.provide(SiteRepository.layer),
  Layer.provide(RoadmapRepository.layer)
);
