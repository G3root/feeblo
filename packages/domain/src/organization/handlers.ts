import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { EntitlementPolicy } from "../entitlement/policies";
import * as Policy from "../policy";
import { NotFoundError, withRemapDbErrors } from "../rpc-errors";
import { CurrentSession } from "../session-middleware";
import { WorkspaceRepository } from "../workspace/repository";
import { OrganizationRepository } from "./repository";
import { OrganizationRpcs } from "./rpcs";
import type { TOrganizationUpdate } from "./schema";

const canManageOrganization = (organizationId: string) =>
  Policy.canPermission(organizationId, "workspace.update");

export const OrganizationRpcHandlersEffect = Effect.gen(function* () {
  const repository = yield* OrganizationRepository;
  const entitlementPolicy = yield* EntitlementPolicy;
  // Workspace settings are a write; a locked workspace keeps its current
  // identity until the owner resolves the plan.
  const canManageOrganizationWritable = (organizationId: string) =>
    Policy.all(
      canManageOrganization(organizationId),
      entitlementPolicy.assertWorkspaceWritable(organizationId)
    );

  return {
    ListOrganizations: () =>
      Effect.gen(function* () {
        const session = yield* CurrentSession;

        return yield* repository.findManyByUserId({
          userId: session.session.userId,
        });
      }).pipe(withRemapDbErrors("Organization", "select")),
    UpdateOrganization: (args: TOrganizationUpdate) =>
      Effect.gen(function* () {
        const organization = yield* repository.update(args);

        if (Option.isNone(organization)) {
          return yield* new NotFoundError({
            message: "Organization not found",
          });
        }

        return;
      }).pipe(
        Policy.withPolicy(canManageOrganizationWritable(args.organizationId)),
        withRemapDbErrors("Organization", "update")
      ),
  };
});

export const OrganizationRpcHandlers = OrganizationRpcs.toLayer(
  OrganizationRpcHandlersEffect
).pipe(
  Layer.provide(EntitlementPolicy.layer),
  Layer.provide(WorkspaceRepository.layer),
  Layer.provide(OrganizationRepository.layer)
);
