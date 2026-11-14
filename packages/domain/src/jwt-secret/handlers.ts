import { transaction } from "@feeblo/db";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { actorFromSession } from "../audit-log/attribution";
import { AuditLogRecorder } from "../audit-log/recorder";
import * as Policy from "../policy";
import { withRemapDbErrors } from "../rpc-errors";
import { CurrentSession } from "../session-middleware";
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
    RevokeJwtSecret: (args: TJwtSecretRevoke) =>
      Effect.gen(function* () {
        const session = yield* CurrentSession;
        const audit = yield* AuditLogRecorder;
        yield* transaction(
          Effect.gen(function* () {
            yield* repository.revoke(args);
            // `jwt_secret` is a singleton resource, so no `resourceId`. Only
            // the id of the secret is recorded: the value is never read here,
            // and this module generates it, so nothing credential-shaped can
            // reach the entry.
            yield* audit.record({
              organizationId: args.organizationId,
              actor: actorFromSession(session, args.organizationId),
              source: "dashboard",
              action: "jwt_secret.revoked",
              metadata: { secretId: args.secretId },
            });
          })
        );
      }).pipe(
        Policy.withPolicy(canManageJwtSecret(args.organizationId)),
        withRemapDbErrors("JwtSecret", "update")
      ),
    RotateJwtSecret: ({ organizationId }: TJwtSecretRotate) =>
      repository
        .rotate({ organizationId })
        .pipe(
          Policy.withPolicy(canManageJwtSecret(organizationId)),
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
  Layer.provide(JwtSecretRepository.layer),
  Layer.provide(AuditLogRecorder.layer)
);
