import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as Policy from "../policy";
import { withRemapDbErrors } from "../rpc-errors";
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

  return {
    JwtSecretRevoke: (args: TJwtSecretRevoke) =>
      repository
        .revoke(args)
        .pipe(
          Policy.withPolicy(canManageJwtSecret(args.organizationId)),
          withRemapDbErrors("JwtSecret", "update")
        ),
    JwtSecretRotate: ({ organizationId }: TJwtSecretRotate) =>
      repository
        .rotate({ organizationId })
        .pipe(
          Policy.withPolicy(canManageJwtSecret(organizationId)),
          withRemapDbErrors("JwtSecret", "update")
        ),
    JwtSecretList: ({ organizationId }: TJwtSecretList) =>
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
).pipe(Layer.provide(JwtSecretRepository.layer));
