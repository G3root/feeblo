import { RESERVED_SUBDOMAINS, slugify } from "@feeblo/utils/url";
import { Effect, Layer, Option } from "effect";
import * as Policy from "../policy";
import { BadRequestError, withRemapDbErrors } from "../rpc-errors";
import { CurrentSession } from "../session-middleware";
import { WorkspaceRepository } from "./repository";
import { WorkspaceRpcs } from "./rpcs";
import type {
  TCreateWorkspaceInput,
  TWorkspaceInput,
  TWorkspaceSlugCheckInput,
} from "./schema";

const isReservedSubdomain = (subdomain: string) =>
  RESERVED_SUBDOMAINS.includes(subdomain);

export const WorkspaceRpcHandlers = WorkspaceRpcs.toLayer(
  Effect.gen(function* () {
    const repository = yield* WorkspaceRepository;

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
          if (isReservedSubdomain(subdomain)) {
            return yield* new BadRequestError({
              message:
                "This workspace name is reserved. Please choose another.",
            });
          }

          const isSubdomainTaken =
            yield* repository.isSubdomainTaken(subdomain);

          if (isSubdomainTaken) {
            return yield* new BadRequestError({
              message: "This workspace name is already taken",
            });
          }

          const organizationId = yield* repository.createWorkspace({
            userId: session.session.userId,
            workspaceName,
            subdomain,
          });

          return { organizationId };
        }).pipe(withRemapDbErrors("Workspace", "create"));
      },
      WorkspaceProductList: () =>
        repository
          .findProducts()
          .pipe(withRemapDbErrors("Workspace", "select")),
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
        Effect.gen(function* () {
          if (isReservedSubdomain(args.slug)) {
            return { available: false, suggestion: null };
          }
          const taken = yield* repository.isSubdomainTaken(args.slug);
          if (!taken) {
            return { available: true, suggestion: null };
          }
          const suggestion = yield* repository.getSubdomainSuggestion(
            args.slug
          );
          return {
            available: false,
            suggestion: Option.getOrNull(suggestion),
          };
        }).pipe(withRemapDbErrors("Workspace", "select")),
    };
  })
).pipe(Layer.provide(WorkspaceRepository.layer));
