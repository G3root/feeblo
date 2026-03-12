import { slugify } from "@feeblo/utils/url";
import { Effect, Layer } from "effect";
import * as Policy from "../policy";
import {
  BadRequestError,
  mapToInternalServerError,
  onInternalServerError,
  UnauthorizedError,
} from "../rpc-errors";
import { CurrentSession } from "../session-middleware";
import { WorkspaceRepository } from "./repository";
import { WorkspaceRpcs } from "./rpcs";
import type { TCreateWorkspaceInput, TWorkspaceInput } from "./schema";

export const WorkspaceRpcHandlers = WorkspaceRpcs.toLayer(
  Effect.gen(function* () {
    const repository = yield* WorkspaceRepository;

    return {
      WorkspaceCreate: (args: TCreateWorkspaceInput) => {
        return Effect.gen(function* () {
          const session = yield* CurrentSession;
          const workspaceName = args.workspaceName.trim();

          const slug = slugify(workspaceName);
          if (!slug) {
            return yield* Effect.fail(
              new BadRequestError({ message: "Invalid workspace name" })
            );
          }

          const isSlugTaken = yield* repository.isOrganizationSlugTaken({
            slug,
          });

          if (isSlugTaken) {
            return yield* Effect.fail(
              new BadRequestError({
                message: "Company name is already taken",
              })
            );
          }

          const organizationId =
            yield* repository.createWorkspace({
              userId: session.session.userId,
              workspaceName,
              slug,
            });

          return { organizationId };
        }).pipe(
          Effect.mapError(
            mapToInternalServerError(UnauthorizedError, BadRequestError)
          )
        );
      },
      WorkspaceProductList: () =>
        repository.findProducts().pipe(Effect.catchAll(onInternalServerError)),
      WorkspaceSubscriptionGet: (args: TWorkspaceInput) =>
        repository
          .findSubscriptionByOrganizationId({
            organizationId: args.organizationId,
          })
          .pipe(
            Policy.withPolicy(Policy.hasMembership(args.organizationId)),
            Effect.catchAll(onInternalServerError)
          ),
    };
  })
).pipe(Layer.provide(WorkspaceRepository.Default));
