import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

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
      // The first roadmap in an organization becomes the primary one; the
      // repository claims primary status atomically (backed by the partial
      // unique index roadmap_primary_organizationId_uidx) and falls back to a
      // non-primary create when another roadmap already holds it, so
      // concurrent creates cannot both become primary.
      repository
        .create({
          ...args,
          isPrimary: true,
        })
        .pipe(
          Policy.withPolicy(
            roadmapPolicy.canCreate({
              organizationId: args.organizationId,
              visibility: args.visibility,
            })
          ),
          withRemapDbErrors("Roadmap", "create")
        ),
    RoadmapUpdate: (args: TRoadmapUpdate) =>
      repository.update(args).pipe(
        Policy.withPolicy(
          roadmapPolicy.canUpdate({
            organizationId: args.organizationId,
            roadmapId: args.id,
            visibility: args.visibility,
          })
        ),
        withRemapDbErrors("Roadmap", "update")
      ),
    RoadmapDelete: (args: TRoadmapDelete) =>
      // Deletion and primary handoff run in one organization-scoped
      // transaction (see RoadmapRepository.deleteWithPrimaryHandoff), so a
      // concurrent create/delete cannot leave the organization with zero or
      // multiple primary roadmaps.
      repository
        .deleteWithPrimaryHandoff(args)
        .pipe(
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
  Layer.provide(RoadmapPolicy.layer),
  Layer.provide(EntitlementPolicy.layer),
  Layer.provide(WorkspaceRepository.layer),
  Layer.provide(SiteRepository.layer),
  Layer.provide(RoadmapRepository.layer)
);
