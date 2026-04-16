import { Schema } from "effect";

export class Organization extends Schema.Class<Organization>("Organization")({
  id: Schema.String,
  name: Schema.String,
  slug: Schema.String,
  logo: Schema.NullOr(Schema.String),
  createdAt: Schema.Date,
}) {}

export const OrganizationUpdate = Schema.Struct({
  organizationId: Schema.String,
  name: Schema.String,
  logo: Schema.NullOr(Schema.String),
});

export type TOrganizationUpdate = Schema.Schema.Type<typeof OrganizationUpdate>;
