import * as Permissions from "@feeblo/permissions";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { BoardRepository } from "../board/repository";
import { ChangelogCategoryRepository } from "../changelog-category/repository";
import { CompanyRepository } from "../company/repository";
import { ContactRepository } from "../contact/repository";
import { MembershipRepository } from "../membership/repository";
import * as Policy from "../policy";
import { PostRepository } from "../post/repository";
import { RoadmapRepository } from "../roadmap/repository";
import { withRemapDbErrors } from "../rpc-errors";
import { CurrentSession } from "../session-middleware";
import { WorkspaceRepository } from "../workspace/repository";
import { PlanCompliance } from "./compliance";
import { PlanComplianceRpcs } from "./rpcs";
import type { TPlanComplianceInput } from "./schema";

export const PlanComplianceRpcHandlersEffect = Effect.gen(function* () {
  const planCompliance = yield* PlanCompliance;

  return {
    /**
     * Any member may learn that the workspace is over plan — the gate blocks
     * them too. Only a member who can act on billing sees the resource rows;
     * everyone else gets the kinds and counts, which is enough to explain the
     * block without exposing invitation addresses.
     */
    GetWorkspacePlanCompliance: (args: TPlanComplianceInput) =>
      Effect.gen(function* () {
        const session = yield* CurrentSession;

        return yield* planCompliance.snapshot({
          includeResources: Permissions.can(
            session,
            args.organizationId,
            "billing.*"
          ),
          organizationId: args.organizationId,
        });
      }).pipe(
        Policy.withPolicy(Policy.hasMembership(args.organizationId)),
        withRemapDbErrors("PlanCompliance", "select")
      ),
  };
});

export const PlanComplianceRpcHandlers = PlanComplianceRpcs.toLayer(
  PlanComplianceRpcHandlersEffect
).pipe(
  Layer.provide(PlanCompliance.layer),
  Layer.provide(BoardRepository.layer),
  Layer.provide(ChangelogCategoryRepository.layer),
  Layer.provide(CompanyRepository.layer),
  Layer.provide(ContactRepository.layer),
  Layer.provide(MembershipRepository.layer),
  Layer.provide(PostRepository.layer),
  Layer.provide(RoadmapRepository.layer),
  Layer.provide(WorkspaceRepository.layer)
);
