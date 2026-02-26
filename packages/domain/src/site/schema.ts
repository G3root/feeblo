import { Schema } from "effect";

export class Site extends Schema.Class<Site>("Site")({
  id: Schema.String,
  name: Schema.String,
  subdomain: Schema.String,
  customDomain: Schema.Union(Schema.String, Schema.Null),
  createdAt: Schema.Date,
  updatedAt: Schema.Date,
  organizationId: Schema.String,
}) {}

export const SiteList = Schema.Struct({
  organizationId: Schema.String,
});

export type TSiteList = Schema.Schema.Type<typeof SiteList>;
