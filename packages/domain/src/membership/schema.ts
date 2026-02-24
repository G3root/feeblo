import { Schema } from "effect";

export class Membership extends Schema.Class<Membership>("Membership")({
  id: Schema.String,
  organizationId: Schema.String,
  userId: Schema.String,
  role: Schema.String,
  createdAt: Schema.Date,
  organization: Schema.Struct({
    id: Schema.String,
    name: Schema.String,
    slug: Schema.String,
  }),
}) {}

export type TMembership = Schema.Schema.Type<typeof Membership>;
