import { transaction } from "@feeblo/db";
import { slugify } from "@feeblo/utils/url";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import type { PlanLockState } from "../entitlement/lock";
import { EntitlementPolicy } from "../entitlement/policies";
import * as Policy from "../policy";
import { BadRequestError, withRemapDbErrors } from "../rpc-errors";
import { CurrentSession } from "../session-middleware";
import { SubdomainValidationService } from "../site/subdomain/service";
import { WorkspacePolicy } from "./policies";
import { WorkspaceRepository } from "./repository";
import { WorkspaceRpcs } from "./rpcs";
import type {
  TCreateWorkspaceInput,
  TWorkspaceInput,
  TWorkspacePlanLock,
  TWorkspacePlanLockSelectionInput,
  TWorkspaceSlugCheckInput,
} from "./schema";

/**
 * Projects the computed lock state onto the wire shape. The kept set is
 * dropped on purpose: it is the complement of `lockedIds` inside a resource
 * list the caller already has, and on a plan with no limit it would be every
 * row (a Professional workspace's CRM feature alone could be thousands of
 * ids).
 */
const toWorkspacePlanLockState = (
  state: PlanLockState
): TWorkspacePlanLock["current"] => ({
  plan: state.plan,
  features: state.features.map(({ feature, limit, count, lockedIds }) => ({
    feature,
    limit,
    count,
    lockedIds: [...lockedIds],
  })),
});

export const WorkspaceRpcHandlersEffect = Effect.gen(function* () {
  const repository = yield* WorkspaceRepository;
  const workspacePolicy = yield* WorkspacePolicy;
  const entitlementPolicy = yield* EntitlementPolicy;
  const { validate: validateSubdomain } = yield* SubdomainValidationService;

  return {
    CreateWorkspace: (args: TCreateWorkspaceInput) => {
      return Effect.gen(function* () {
        const session = yield* CurrentSession;
        const workspaceName = args.workspaceName.trim();

        const subdomain = slugify(workspaceName);
        if (subdomain.length < 4) {
          return yield* new BadRequestError({
            message:
              "Workspace name must produce a subdomain of at least 4 characters",
          });
        }

        yield* validateSubdomain(subdomain);

        const organizationId = yield* transaction(
          Effect.gen(function* () {
            // Lock first, then count: the per-user workspace cap spans
            // workspaces, so the count is only authoritative while this row
            // is held. Locking before the first child insert avoids
            // deadlocking two concurrent creates against each other.
            yield* repository.lockUser(session.session.userId);
            yield* workspacePolicy.canCreateWorkspace({
              userId: session.session.userId,
            });

            const isSubdomainTaken =
              yield* repository.isSubdomainTaken(subdomain);

            if (isSubdomainTaken) {
              return yield* new BadRequestError({
                message: "This workspace name is already taken",
              });
            }

            return yield* repository.createWorkspace({
              userId: session.session.userId,
              workspaceName,
              subdomain,
            });
          })
        );

        return { organizationId };
      }).pipe(withRemapDbErrors("Workspace", "create"));
    },
    GetWorkspaceCreationState: () =>
      Effect.gen(function* () {
        const session = yield* CurrentSession;
        return yield* workspacePolicy.getCreationState({
          userId: session.session.userId,
        });
      }).pipe(withRemapDbErrors("Workspace", "select")),
    ListWorkspaceProducts: () =>
      repository.findProducts().pipe(withRemapDbErrors("Workspace", "select")),
    GetWorkspacePlan: (args: TWorkspaceInput) =>
      repository
        .findPlanByOrganizationId({
          organizationId: args.organizationId,
        })
        .pipe(
          Policy.withPolicy(Policy.hasMembership(args.organizationId)),
          withRemapDbErrors("Workspace", "select")
        ),
    GetWorkspacePlanLock: (args: TWorkspaceInput) =>
      Effect.gen(function* () {
        // The lock is a property of the workspace, not of the caller: the
        // policy resolves the workspace's owners itself, so an admin reading
        // it sees the owner's cap and not their own account's.
        const current = yield* entitlementPolicy.getPlanLock({
          organizationId: args.organizationId,
        });
        // On free the preview is the current state; only a paid workspace
        // needs the second, free-evaluated computation.
        const preview =
          current.plan === "free"
            ? current
            : yield* entitlementPolicy.getPlanLockPreview({
                organizationId: args.organizationId,
              });

        return {
          current: toWorkspacePlanLockState(current),
          preview: toWorkspacePlanLockState(preview),
        };
      }).pipe(
        Policy.withPolicy(Policy.hasMembership(args.organizationId)),
        withRemapDbErrors("Workspace", "select")
      ),
    SetWorkspacePlanLockSelection: (args: TWorkspacePlanLockSelectionInput) =>
      Effect.gen(function* () {
        const current = yield* entitlementPolicy.setPlanLockSelection({
          featureKey: args.featureKey,
          organizationId: args.organizationId,
          resourceIds: args.resourceIds,
        });
        const preview =
          current.plan === "free"
            ? current
            : yield* entitlementPolicy.getPlanLockPreview({
                organizationId: args.organizationId,
              });

        return {
          current: toWorkspacePlanLockState(current),
          preview: toWorkspacePlanLockState(preview),
        };
      }).pipe(
        Policy.withPolicy(
          Policy.all(
            Policy.hasMembership(args.organizationId),
            Policy.canPermission(args.organizationId, "workspace.update")
          )
        ),
        withRemapDbErrors("Workspace", "update")
      ),
    CheckWorkspaceSlug: (args: TWorkspaceSlugCheckInput) =>
      validateSubdomain(args.slug).pipe(
        Effect.matchEffect({
          onFailure: (error) =>
            Effect.succeed({
              available: false,
              suggestion: null,
              reason: error.message,
            }),
          onSuccess: () =>
            Effect.gen(function* () {
              const taken = yield* repository.isSubdomainTaken(args.slug);
              if (!taken) {
                return {
                  available: true,
                  suggestion: null,
                  reason: null,
                };
              }
              const suggestion = yield* repository.getSubdomainSuggestion(
                args.slug
              );
              return {
                available: false,
                suggestion: Option.getOrNull(suggestion),
                reason: "This workspace name is already taken",
              };
            }),
        }),
        withRemapDbErrors("Workspace", "select")
      ),
  };
});

export const WorkspaceRpcHandlers = WorkspaceRpcs.toLayer(
  WorkspaceRpcHandlersEffect
).pipe(
  Layer.provide(WorkspaceRepository.layer),
  Layer.provide(WorkspacePolicy.layer),
  Layer.provide(EntitlementPolicy.layer),
  Layer.provide(SubdomainValidationService.layerEnv)
);
