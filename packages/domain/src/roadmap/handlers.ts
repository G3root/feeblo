import { transaction } from "@feeblo/db";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { actorFromSession } from "../audit-log/attribution";
import { AuditLogRecorder } from "../audit-log/recorder";
import { EntitlementPolicy } from "../entitlement/policies";
import * as Policy from "../policy";
import * as RateLimit from "../rate-limit";
import { withRemapDbErrors } from "../rpc-errors";
import { CurrentSession } from "../session-middleware";
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
    ListRoadmaps: (args: TRoadmapList) =>
      repository
        .findMany(args)
        .pipe(
          Policy.withPolicy(Policy.hasMembership(args.organizationId)),
          withRemapDbErrors("Roadmap", "select")
        ),
    ListRoadmapsPublic: (args: TRoadmapList) =>
      repository
        .findMany({ organizationId: args.organizationId, visibility: "public" })
        .pipe(
          RateLimit.withPublicRpcRateLimit({
            name: "ListRoadmapsPublic",
            level: "read",
          }),
          Policy.withPublicPolicy(
            sitePolicy.canViewRoadmap(args.organizationId)
          ),
          withRemapDbErrors("Roadmap", "select")
        ),
    CreateRoadmap: (args: TRoadmapCreate) =>
      // The first roadmap in an organization becomes the primary one; the
      // repository claims primary status atomically (backed by the partial
      // unique index roadmap_primary_organizationId_uidx) and falls back to a
      // non-primary create when another roadmap already holds it, so
      // concurrent creates cannot both become primary.
      Effect.gen(function* () {
        const session = yield* CurrentSession;
        const audit = yield* AuditLogRecorder;
        yield* transaction(
          Effect.gen(function* () {
            yield* repository.create({
              ...args,
              isPrimary: true,
            });
            yield* audit.record({
              organizationId: args.organizationId,
              actor: actorFromSession(session, args.organizationId),
              source: "dashboard",
              action: "roadmap.created",
              resourceId: args.id,
            });
          })
        );
      }).pipe(
        Policy.withPolicy(
          roadmapPolicy.canCreate({
            organizationId: args.organizationId,
            visibility: args.visibility,
          })
        ),
        withRemapDbErrors("Roadmap", "create")
      ),
    UpdateRoadmap: (args: TRoadmapUpdate) =>
      Effect.gen(function* () {
        const session = yield* CurrentSession;
        const audit = yield* AuditLogRecorder;
        yield* transaction(
          Effect.gen(function* () {
            yield* repository.update(args);
            yield* audit.record({
              organizationId: args.organizationId,
              actor: actorFromSession(session, args.organizationId),
              source: "dashboard",
              action: "roadmap.updated",
              resourceId: args.id,
              metadata: {
                isPrimary: args.isPrimary,
                visibility: args.visibility,
              },
            });
          })
        );
      }).pipe(
        Policy.withPolicy(
          roadmapPolicy.canUpdate({
            organizationId: args.organizationId,
            roadmapId: args.id,
            visibility: args.visibility,
          })
        ),
        withRemapDbErrors("Roadmap", "update")
      ),
    DeleteRoadmap: (args: TRoadmapDelete) =>
      // Deletion and primary handoff run in one organization-scoped
      // transaction (see RoadmapRepository.deleteWithPrimaryHandoff), so a
      // concurrent create/delete cannot leave the organization with zero or
      // multiple primary roadmaps.
      Effect.gen(function* () {
        const session = yield* CurrentSession;
        const audit = yield* AuditLogRecorder;
        yield* transaction(
          Effect.gen(function* () {
            yield* repository.deleteWithPrimaryHandoff(args);
            yield* audit.record({
              organizationId: args.organizationId,
              actor: actorFromSession(session, args.organizationId),
              source: "dashboard",
              action: "roadmap.deleted",
              resourceId: args.id,
            });
          })
        );
      }).pipe(
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
  Layer.provide(RoadmapRepository.layer),
  Layer.provide(AuditLogRecorder.layer)
);
