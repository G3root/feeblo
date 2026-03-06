import { Schema } from "effect";

const ROLE_LITERAL = Schema.Literal("owner", "admin", "member");

export const Membership = Schema.Struct({
  id: Schema.String,
  organizationId: Schema.String,
  userId: Schema.String,
  role: ROLE_LITERAL,
  createdAt: Schema.Date,
  organization: Schema.Struct({
    id: Schema.String,
    name: Schema.String,
    slug: Schema.String,
  }),
});

export type TMembership = Schema.Schema.Type<typeof Membership>;

export const OrganizationMember = Schema.Struct({
  id: Schema.String,
  organizationId: Schema.String,
  userId: Schema.String,
  role: ROLE_LITERAL,
  createdAt: Schema.Date,
  user: Schema.Struct({
    id: Schema.String,
    name: Schema.String,
    email: Schema.String,
    image: Schema.NullOr(Schema.String),
  }),
});

export const OrganizationInvitation = Schema.Struct({
  id: Schema.String,
  organizationId: Schema.String,
  email: Schema.String,
  role: Schema.NullOr(Schema.String),
  status: Schema.String,
  expiresAt: Schema.Date,
  inviterId: Schema.String,
  createdAt: Schema.Date,
});

export const OrganizationId = Schema.Struct({
  organizationId: Schema.String,
});

export const InviteMember = Schema.Struct({
  organizationId: Schema.String,
  email: Schema.String,
  role: ROLE_LITERAL,
});

export const UpdateMemberRole = Schema.Struct({
  organizationId: Schema.String,
  memberId: Schema.String,
  role: ROLE_LITERAL,
});

export const RemoveMember = Schema.Struct({
  organizationId: Schema.String,
  memberId: Schema.String,
});

export const CancelInvitation = Schema.Struct({
  organizationId: Schema.String,
  invitationId: Schema.String,
});
