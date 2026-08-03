import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as Policy from "../policy";
import { NotFoundError, withRemapDbErrors } from "../rpc-errors";
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

export const OrganizationRpcHandlersEffect = Effect.gen(function* () {
  const repository = yield* OrganizationRepository;

  return {
    OrganizationList: () =>
      Effect.gen(function* () {
        const session = yield* CurrentSession;

        return yield* repository.findManyByUserId({
          userId: session.session.userId,
        });
      }).pipe(withRemapDbErrors("Organization", "select")),
    OrganizationUpdate: (args: TOrganizationUpdate) =>
      Effect.gen(function* () {
        const organization = yield* repository.update(args);

        if (Option.isNone(organization)) {
          return yield* new NotFoundError({
            message: "Organization not found",
          });
        }

        return;
      }).pipe(
        Policy.withPolicy(canManageOrganization(args.organizationId)),
        withRemapDbErrors("Organization", "update")
      ),
  };
});

export const OrganizationRpcHandlers = OrganizationRpcs.toLayer(
  OrganizationRpcHandlersEffect
).pipe(Layer.provide(OrganizationRepository.layer));
