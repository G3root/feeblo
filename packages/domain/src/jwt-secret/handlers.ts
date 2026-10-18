import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { EntitlementPolicy } from "../entitlement/policies";
import * as Policy from "../policy";
import { withRemapDbErrors } from "../rpc-errors";
import { WorkspaceRepository } from "../workspace/repository";
import { JwtSecretRepository } from "./repository";
import { JwtSecretRpcs } from "./rpcs";
import type {
  TJwtSecretList,
  TJwtSecretRevoke,
  TJwtSecretRotate,
} from "./schema";

const canManageJwtSecret = (organizationId: string) =>
  Policy.canPermission(organizationId, "workspace.update");

export const JwtSecretRpcHandlersEffect = Effect.gen(function* () {
  const repository = yield* JwtSecretRepository;
  const entitlementPolicy = yield* EntitlementPolicy;
  // Rotation mints a credential, so a locked workspace refuses it; revoking
  // one is cleanup and stays open.
  const canRotateJwtSecret = (organizationId: string) =>
    Policy.all(
      canManageJwtSecret(organizationId),
      entitlementPolicy.assertWorkspaceWritable(organizationId)
    );

  return {
    RevokeJwtSecret: (args: TJwtSecretRevoke) =>
      repository
        .revoke(args)
        .pipe(
          Policy.withPolicy(canManageJwtSecret(args.organizationId)),
          withRemapDbErrors("JwtSecret", "update")
        ),
    RotateJwtSecret: ({ organizationId }: TJwtSecretRotate) =>
      repository
        .rotate({ organizationId })
        .pipe(
          Policy.withPolicy(canRotateJwtSecret(organizationId)),
          withRemapDbErrors("JwtSecret", "update")
        ),
    ListJwtSecrets: ({ organizationId }: TJwtSecretList) =>
      repository
        .getSecretsForOrg({ organizationId })
        .pipe(
          Policy.withPolicy(canManageJwtSecret(organizationId)),
          withRemapDbErrors("JwtSecret", "select")
        ),
  };
});

export const JwtSecretRpcHandlers = JwtSecretRpcs.toLayer(
  JwtSecretRpcHandlersEffect
).pipe(
  Layer.provide(EntitlementPolicy.layer),
  Layer.provide(WorkspaceRepository.layer),
  Layer.provide(JwtSecretRepository.layer)
);
