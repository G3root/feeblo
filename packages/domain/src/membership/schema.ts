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

export class OrganizationMember extends Schema.Class<OrganizationMember>(
  "OrganizationMember"
)({
  id: Schema.String,
  organizationId: Schema.String,
  userId: Schema.String,
  role: Schema.String,
  createdAt: Schema.Date,
  user: Schema.Struct({
    id: Schema.String,
    name: Schema.String,
    email: Schema.String,
    image: Schema.NullOr(Schema.String),
  }),
}) {}

export class OrganizationInvitation extends Schema.Class<OrganizationInvitation>(
  "OrganizationInvitation"
)({
  id: Schema.String,
  organizationId: Schema.String,
  email: Schema.String,
  role: Schema.NullOr(Schema.String),
  status: Schema.String,
  expiresAt: Schema.Date,
  inviterId: Schema.String,
  createdAt: Schema.Date,
}) {}

export class OrganizationIdInput extends Schema.Class<OrganizationIdInput>(
  "OrganizationIdInput"
)({
  organizationId: Schema.String,
}) {}

export class InviteMemberInput extends Schema.Class<InviteMemberInput>(
  "InviteMemberInput"
)({
  organizationId: Schema.String,
  email: Schema.String,
  role: Schema.String,
}) {}

export class UpdateMemberRoleInput extends Schema.Class<UpdateMemberRoleInput>(
  "UpdateMemberRoleInput"
)({
  organizationId: Schema.String,
  memberId: Schema.String,
  role: Schema.String,
}) {}

export class RemoveMemberInput extends Schema.Class<RemoveMemberInput>(
  "RemoveMemberInput"
)({
  organizationId: Schema.String,
  memberId: Schema.String,
}) {}

export class CancelInvitationInput extends Schema.Class<CancelInvitationInput>(
  "CancelInvitationInput"
)({
  organizationId: Schema.String,
  invitationId: Schema.String,
}) {}
