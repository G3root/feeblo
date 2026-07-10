import { JwtSecretId, WorkspaceId } from "@feeblo/id";
import * as S from "effect/Schema";

export const JwtSecret = S.Struct({
  id: S.String,
  organizationId: S.String,
  createdAt: S.DateFromString,
  revokedAt: S.NullOr(S.DateFromString),
});

export const JwtSecretWithSecret = S.Struct({
  id: S.String,
  organizationId: S.String,
  createdAt: S.DateFromString,
  revokedAt: S.NullOr(S.DateFromString),
  secret: S.String,
});

export const JwtSecretGetOrCreate = S.Struct({
  organizationId: WorkspaceId.schema,
});

export const JwtSecretRevoke = S.Struct({
  organizationId: WorkspaceId.schema,
  secretId: JwtSecretId.schema,
});

export const JwtSecretRotate = S.Struct({
  organizationId: WorkspaceId.schema,
});

export const JwtSecretList = S.Struct({
  organizationId: WorkspaceId.schema,
});

export type TJwtSecretGetOrCreate = S.Schema.Type<typeof JwtSecretGetOrCreate>;
export type TJwtSecretRevoke = S.Schema.Type<typeof JwtSecretRevoke>;
export type TJwtSecretRotate = S.Schema.Type<typeof JwtSecretRotate>;
export type TJwtSecretList = S.Schema.Type<typeof JwtSecretList>;
