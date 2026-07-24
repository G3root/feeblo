import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Policy from "../policy";
import { withRemapDbErrors } from "../rpc-errors";
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
        .pipe(withRemapDbErrors("RoadmapColumn", "select")),
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
).pipe(Layer.provide(RoadmapColumnRepository.layer));
