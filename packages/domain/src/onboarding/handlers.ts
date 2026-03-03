import { slugify } from "@feeblo/utils/url";
import { Effect, Layer } from "effect";
import {
  BadRequestError,
  mapToInternalServerError,
  UnauthorizedError,
} from "../rpc-errors";
import { CurrentSession } from "../session-middleware";
import { OnboardingRepository } from "./repository";
import { OnboardingRpcs } from "./rpcs";
import type { TCompleteOnboardingInput } from "./schema";

export const OnboardingRpcHandlers = OnboardingRpcs.toLayer(
  Effect.gen(function* () {
    const repository = yield* OnboardingRepository;

    return {
      OnboardingComplete: (args: TCompleteOnboardingInput) => {
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

          const ensuredOrganizationId =
            yield* repository.createInitialWorkspaceForUser({
              userId: session.session.userId,
              workspaceName,
              slug,
            });

          yield* repository.markUserOnboarded({
            userId: session.session.userId,
          });

          return {
            organizationId: ensuredOrganizationId,
          };
        }).pipe(
          Effect.mapError(
            mapToInternalServerError(UnauthorizedError, BadRequestError)
          )
        );
      },
    };
  })
).pipe(Layer.provide(OnboardingRepository.Default));
