import { Effect, Layer } from "effect";
import * as Policy from "../policy";
import { InternalServerError, NotFoundError } from "../rpc-errors";
import { CurrentSession } from "../session-middleware";
import { OrganizationRepository } from "./repository";
import { OrganizationRpcs } from "./rpcs";
import type { TOrganizationUpdate } from "./schema";

const canManageOrganization = (organizationId: string) =>
  Policy.policy((session) =>
    Effect.succeed(
      session.memberships.some(
        (membership) =>
          membership.organizationId === organizationId &&
          (membership.role === "owner" || membership.role === "admin")
      )
    )
  );

export const OrganizationRpcHandlers = OrganizationRpcs.toLayer(
  Effect.gen(function* () {
    const repository = yield* OrganizationRepository;

    return {
      OrganizationList: () =>
        Effect.gen(function* () {
          const session = yield* CurrentSession;

          return yield* repository.findManyByUserId({
            userId: session.session.userId,
          });
        }).pipe(
          Effect.catchTags({
            SqlError: () =>
              Effect.fail(
                new InternalServerError({
                  message: "Failed to list organizations",
                })
              ),
          })
        ),
      OrganizationUpdate: (args: TOrganizationUpdate) =>
        Effect.gen(function* () {
          const organization = yield* repository.update(args);

          if (!organization) {
            return yield* new NotFoundError({
              message: "Organization not found",
            });
          }

          return;
        }).pipe(
          Policy.withPolicy(canManageOrganization(args.organizationId)),
          Effect.catchTag("SqlError", () =>
            Effect.fail(
              new InternalServerError({
                message: "Failed to update organization",
              })
            )
          )
        ),
    };
  })
).pipe(Layer.provide(OrganizationRepository.layer));
