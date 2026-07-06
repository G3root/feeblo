import { currentDb, schema } from "@feeblo/db";
import { and, eq, inArray } from "drizzle-orm";
import * as EffectArray from "effect/Array";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { PRIVILEGED_MEMBER_ROLES } from "../plan-entitlements";

interface TFindMembershipsByUserId {
  userId: string;
}

interface TFindOrganizationMembers {
  organizationId: string;
}

interface TFindOrganizationInvitations {
  organizationId: string;
}

interface TFindMemberByEmailInOrg {
  email: string;
  organizationId: string;
}

interface TFindOwnersInOrg {
  organizationId: string;
}

interface TFindMemberById {
  memberId: string;
}

interface TDeleteMember {
  memberId: string;
  organizationId: string;
}

interface TUpdateMemberRole {
  memberId: string;
  organizationId: string;
  role: "owner" | "admin" | "member";
}

interface TCreateInvitation {
  email: string;
  expiresAt: Date;
  id: string;
  inviterId: string;
  organizationId: string;
  role: string;
}

interface TCancelInvitation {
  invitationId: string;
  organizationId: string;
}

interface TCountByOrganizationId {
  organizationId: string;
}

const makeMembershipRepository = Effect.gen(function* () {
  return {
    findMembershipsByUserId: ({ userId }: TFindMembershipsByUserId) =>
      Effect.gen(function* () {
        const db = yield* currentDb;
        return yield* db
          .select({
            id: schema.memberTable.id,
            organizationId: schema.memberTable.organizationId,
            userId: schema.memberTable.userId,
            role: schema.memberTable.role,
            createdAt: schema.memberTable.createdAt,
          })
          .from(schema.memberTable)
          .where(eq(schema.memberTable.userId, userId));
      }),
    findOrganizationMembers: ({ organizationId }: TFindOrganizationMembers) =>
      Effect.gen(function* () {
        const db = yield* currentDb;
        return yield* db
          .select({
            id: schema.memberTable.id,
            organizationId: schema.memberTable.organizationId,
            userId: schema.memberTable.userId,
            role: schema.memberTable.role,
            createdAt: schema.memberTable.createdAt,
            user: {
              id: schema.userTable.id,
              name: schema.userTable.name,
              email: schema.userTable.email,
              image: schema.userTable.image,
            },
          })
          .from(schema.memberTable)
          .innerJoin(
            schema.userTable,
            eq(schema.memberTable.userId, schema.userTable.id)
          )
          .where(eq(schema.memberTable.organizationId, organizationId));
      }),
    findOrganizationInvitations: ({
      organizationId,
    }: TFindOrganizationInvitations) =>
      Effect.gen(function* () {
        const db = yield* currentDb;
        return yield* db
          .select({
            id: schema.invitationTable.id,
            organizationId: schema.invitationTable.organizationId,
            email: schema.invitationTable.email,
            role: schema.invitationTable.role,
            status: schema.invitationTable.status,
            expiresAt: schema.invitationTable.expiresAt,
            inviterId: schema.invitationTable.inviterId,
            createdAt: schema.invitationTable.createdAt,
          })
          .from(schema.invitationTable)
          .where(
            and(
              eq(schema.invitationTable.organizationId, organizationId),
              eq(schema.invitationTable.status, "pending")
            )
          );
      }),
    createInvitation: ({
      id,
      organizationId,
      email,
      role,
      inviterId,
      expiresAt,
    }: TCreateInvitation) =>
      Effect.gen(function* () {
        const db = yield* currentDb;
        return yield* db
          .insert(schema.invitationTable)
          .values({
            id,
            organizationId,
            email,
            role,
            inviterId,
            expiresAt,
            status: "pending",
            createdAt: new Date(),
          })
          .returning({
            id: schema.invitationTable.id,
            organizationId: schema.invitationTable.organizationId,
            email: schema.invitationTable.email,
            role: schema.invitationTable.role,
            status: schema.invitationTable.status,
            expiresAt: schema.invitationTable.expiresAt,
            inviterId: schema.invitationTable.inviterId,
            createdAt: schema.invitationTable.createdAt,
          });
      }),
    updateMemberRole: ({ memberId, organizationId, role }: TUpdateMemberRole) =>
      Effect.gen(function* () {
        const db = yield* currentDb;
        return yield* db
          .update(schema.memberTable)
          .set({
            role,
          })
          .where(
            and(
              eq(schema.memberTable.id, memberId),
              eq(schema.memberTable.organizationId, organizationId)
            )
          )
          .returning({
            id: schema.memberTable.id,
            organizationId: schema.memberTable.organizationId,
            userId: schema.memberTable.userId,
            role: schema.memberTable.role,
            createdAt: schema.memberTable.createdAt,
          })
          .pipe(Effect.asVoid);
      }),

    findMemberById: ({ memberId }: TFindMemberById) =>
      Effect.gen(function* () {
        const db = yield* currentDb;
        return yield* db
          .select({
            id: schema.memberTable.id,
            organizationId: schema.memberTable.organizationId,
            userId: schema.memberTable.userId,
            role: schema.memberTable.role,
            createdAt: schema.memberTable.createdAt,
          })
          .from(schema.memberTable)
          .where(eq(schema.memberTable.id, memberId))
          .pipe(Effect.map(EffectArray.get(0)));
      }),

    deleteMember: ({ memberId, organizationId }: TDeleteMember) =>
      Effect.gen(function* () {
        const db = yield* currentDb;
        yield* db
          .delete(schema.memberTable)
          .where(
            and(
              eq(schema.memberTable.id, memberId),
              eq(schema.memberTable.organizationId, organizationId)
            )
          )
          .pipe(Effect.asVoid);
      }),
    cancelInvitation: ({ organizationId, invitationId }: TCancelInvitation) =>
      Effect.gen(function* () {
        const db = yield* currentDb;
        yield* db
          .update(schema.invitationTable)
          .set({
            status: "canceled",
          })
          .where(
            and(
              eq(schema.invitationTable.id, invitationId),
              eq(schema.invitationTable.organizationId, organizationId)
            )
          )
          .pipe(Effect.asVoid);
      }),
    findMemberByEmailInOrg: ({
      organizationId,
      email,
    }: TFindMemberByEmailInOrg) =>
      Effect.gen(function* () {
        const db = yield* currentDb;
        return yield* db
          .select({ id: schema.memberTable.id })
          .from(schema.memberTable)
          .innerJoin(
            schema.userTable,
            eq(schema.memberTable.userId, schema.userTable.id)
          )
          .where(
            and(
              eq(schema.memberTable.organizationId, organizationId),
              eq(schema.userTable.email, email)
            )
          )
          .pipe(Effect.map(EffectArray.get(0)));
      }),
    findOwnersInOrg: ({ organizationId }: TFindOwnersInOrg) =>
      Effect.gen(function* () {
        const db = yield* currentDb;
        return yield* db
          .select({ id: schema.memberTable.id })
          .from(schema.memberTable)
          .where(
            and(
              eq(schema.memberTable.organizationId, organizationId),
              eq(schema.memberTable.role, "owner")
            )
          );
      }),
    countPrivilegedMembers: ({ organizationId }: TCountByOrganizationId) =>
      Effect.gen(function* () {
        const db = yield* currentDb;
        const members = yield* db
          .select({ id: schema.memberTable.id })
          .from(schema.memberTable)
          .where(
            and(
              eq(schema.memberTable.organizationId, organizationId),
              inArray(schema.memberTable.role, [...PRIVILEGED_MEMBER_ROLES])
            )
          );

        return members.length;
      }),
    countPendingPrivilegedInvitations: ({
      organizationId,
    }: TCountByOrganizationId) =>
      Effect.gen(function* () {
        const db = yield* currentDb;
        const invitations = yield* db
          .select({ id: schema.invitationTable.id })
          .from(schema.invitationTable)
          .where(
            and(
              eq(schema.invitationTable.organizationId, organizationId),
              eq(schema.invitationTable.status, "pending"),
              inArray(schema.invitationTable.role, [...PRIVILEGED_MEMBER_ROLES])
            )
          );

        return invitations.length;
      }),
  };
});

export class MembershipRepository extends Context.Service<MembershipRepository>()(
  "MembershipRepository",
  {
    make: makeMembershipRepository,
  }
) {
  static readonly layer = Layer.effect(this, this.make);
}
