import { WorkspaceId } from "@feeblo/id";
import * as S from "effect/Schema";

export const Organization = S.Struct({
  id: S.String,
  name: S.String,
  slug: S.String,
  logo: S.NullOr(S.String),
  createdAt: S.DateFromString,
});

export const OrganizationUpdate = S.Struct({
  organizationId: WorkspaceId.schema,
  name: S.String,
  logo: S.NullOr(S.String),
});

export type TOrganizationUpdate = S.Schema.Type<typeof OrganizationUpdate>;
