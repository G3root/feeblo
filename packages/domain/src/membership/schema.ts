import { Schema as S } from "effect";

const ROLE_LITERAL = S.Literals(["owner", "admin", "member"]);

export const Membership = S.Struct({
  id: S.String,
  organizationId: S.String,
  userId: S.String,
  role: ROLE_LITERAL,
  createdAt: S.DateFromString,
});

export type TMembership = S.Schema.Type<typeof Membership>;

export const OrganizationMember = S.Struct({
  id: S.String,
  organizationId: S.String,
  userId: S.String,
  role: ROLE_LITERAL,
  createdAt: S.DateFromString,
  user: S.Struct({
    id: S.String,
    name: S.String,
    email: S.String,
    image: S.NullOr(S.String),
  }),
});

export const OrganizationInvitation = S.Struct({
  id: S.String,
  organizationId: S.String,
  email: S.String,
  role: S.NullOr(S.String),
  status: S.String,
  expiresAt: S.DateFromString,
  inviterId: S.String,
  createdAt: S.DateFromString,
});

export const OrganizationId = S.Struct({
  organizationId: S.String,
});

export const InviteMember = S.Struct({
  organizationId: S.String,
  email: S.String,
  role: ROLE_LITERAL,
});

export const UpdateMemberRole = S.Struct({
  organizationId: S.String,
  memberId: S.String,
  role: ROLE_LITERAL,
});

export const RemoveMember = S.Struct({
  organizationId: S.String,
  memberId: S.String,
});

export const CancelInvitation = S.Struct({
  organizationId: S.String,
  invitationId: S.String,
});
