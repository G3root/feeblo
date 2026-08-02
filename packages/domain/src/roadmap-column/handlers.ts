import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { EntitlementPolicy } from "../entitlement/policies";
import * as Policy from "../policy";
import * as RateLimit from "../rate-limit";
import { withRemapDbErrors } from "../rpc-errors";
import { SitePolicy } from "../site/policies";
import { SiteRepository } from "../site/repository";
import { WorkspaceRepository } from "../workspace/repository";
import { RoadmapColumnRepository } from "./repository";
import { RoadmapColumnRpcs } from "./rpcs";
import type {
  TRoadmapColumnCreate,
  TRoadmapColumnDelete,
  TRoadmapColumnList,
  TRoadmapColumnUpdate,
} from "./schema";

export const RoadmapColumnRpcHandlersEffect = Effect.gen(function* () {
  const columns = yield* RoadmapColumnRepository;
  const sitePolicy = yield* SitePolicy;
  const read = (organizationId: string) => Policy.hasMembership(organizationId);
  const manage = (organizationId: string) =>
    Policy.hasOrganizationOwnerOrAdmin(organizationId);
  return {
    RoadmapColumnList: (args: TRoadmapColumnList) =>
      columns
        .findMany(args)
        .pipe(
          Policy.withPolicy(read(args.organizationId)),
          withRemapDbErrors("RoadmapColumn", "select")
        ),
    RoadmapColumnListPublic: (args: TRoadmapColumnList) =>
      columns
        .findMany({ organizationId: args.organizationId, visibility: "public" })
        .pipe(
          RateLimit.withPublicRpcRateLimit({
            name: "RoadmapColumnListPublic",
            level: "read",
          }),
          Policy.withPublicPolicy(
            sitePolicy.canViewRoadmap(args.organizationId)
          ),
          withRemapDbErrors("RoadmapColumn", "select")
        ),
    RoadmapColumnCreate: (args: TRoadmapColumnCreate) =>
      columns
        .create(args)
        .pipe(
          Policy.withPolicy(manage(args.organizationId)),
          withRemapDbErrors("RoadmapColumn", "create")
        ),
    RoadmapColumnUpdate: (args: TRoadmapColumnUpdate) =>
      columns
        .update(args)
        .pipe(
          Policy.withPolicy(manage(args.organizationId)),
          withRemapDbErrors("RoadmapColumn", "update")
        ),
    RoadmapColumnDelete: (args: TRoadmapColumnDelete) =>
      columns
        .delete(args)
        .pipe(
          Policy.withPolicy(manage(args.organizationId)),
          withRemapDbErrors("RoadmapColumn", "delete")
        ),
  };
});
export const RoadmapColumnRpcHandlers = RoadmapColumnRpcs.toLayer(
  RoadmapColumnRpcHandlersEffect
).pipe(
  Layer.provide(SitePolicy.layer),
  Layer.provide(EntitlementPolicy.layer),
  Layer.provide(WorkspaceRepository.layer),
  Layer.provide(SiteRepository.layer),
  Layer.provide(RoadmapColumnRepository.layer)
);
