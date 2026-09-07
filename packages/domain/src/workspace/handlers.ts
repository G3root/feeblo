import { transaction } from "@feeblo/db";
import { slugify } from "@feeblo/utils/url";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { EntitlementPolicy } from "../entitlement/policies";
import { MembershipRepository } from "../membership/repository";
import * as Policy from "../policy";
import { BadRequestError, withRemapDbErrors } from "../rpc-errors";
import { CurrentSession } from "../session-middleware";
import { SubdomainValidationService } from "../site/subdomain/service";
import { WorkspaceRepository } from "./repository";
import { WorkspaceRpcs } from "./rpcs";
import type {
  TCreateWorkspaceInput,
  TWorkspaceInput,
  TWorkspaceSlugCheckInput,
} from "./schema";

export const WorkspaceRpcHandlersEffect = Effect.gen(function* () {
  const repository = yield* WorkspaceRepository;
  const membershipRepository = yield* MembershipRepository;
  const entitlementPolicy = yield* EntitlementPolicy;
  const { validate: validateSubdomain } = yield* SubdomainValidationService;

  return {
    WorkspaceCreate: (args: TCreateWorkspaceInput) => {
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
            const memberships =
              yield* membershipRepository.findMembershipsByUserId({
                userId: session.session.userId,
              });
            const ownedOrganizationIds = memberships
              .filter((membership) => membership.role === "owner")
              .map((membership) => membership.organizationId);

            yield* entitlementPolicy.canCreateWorkspace({
              ownedOrganizationIds,
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
    WorkspaceProductList: () =>
      repository.findProducts().pipe(withRemapDbErrors("Workspace", "select")),
    WorkspacePlanGet: (args: TWorkspaceInput) =>
      repository
        .findPlanByOrganizationId({
          organizationId: args.organizationId,
        })
        .pipe(
          Policy.withPolicy(Policy.hasMembership(args.organizationId)),
          withRemapDbErrors("Workspace", "select")
        ),
    WorkspaceSlugCheck: (args: TWorkspaceSlugCheckInput) =>
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
  Layer.provide(MembershipRepository.layer),
  Layer.provide(EntitlementPolicy.layer),
  Layer.provide(WorkspaceRepository.layer),
  Layer.provide(SubdomainValidationService.layerEnv)
);
