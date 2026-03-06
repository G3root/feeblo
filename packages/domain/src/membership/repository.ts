import { DB } from "@feeblo/db";
import {
  invitation as invitationTable,
  member as memberTable,
  organization as organizationTable,
  user as userTable,
} from "@feeblo/db/schema/auth";
import { and, eq } from "drizzle-orm";
import { Effect, Array as EffectArray } from "effect";

type TFindMembershipsByUserId = {
  userId: string;
};

type TFindOrganizationMembers = {
  organizationId: string;
};

type TFindOrganizationInvitations = {
  organizationId: string;
};

type TFindMemberByEmailInOrg = {
  organizationId: string;
  email: string;
};

type TFindOwnersInOrg = {
  organizationId: string;
};

type TFindMemberById = {
  memberId: string;
};

type TDeleteMember = {
  organizationId: string;
  memberId: string;
};

type TUpdateMemberRole = {
  organizationId: string;
  memberId: string;
  role: "owner" | "admin" | "member";
};

export class MembershipRepository extends Effect.Service<MembershipRepository>()(
  "MembershipRepository",
  {
    effect: Effect.gen(function* () {
      const db = yield* DB;

      return {
        findMembershipsByUserId: (args: TFindMembershipsByUserId) =>
          db
            .select({
              id: memberTable.id,
              organizationId: memberTable.organizationId,
              userId: memberTable.userId,
              role: memberTable.role,
              createdAt: memberTable.createdAt,
              organization: {
                id: organizationTable.id,
                name: organizationTable.name,
                slug: organizationTable.slug,
              },
            })
            .from(memberTable)
            .innerJoin(
              organizationTable,
              eq(memberTable.organizationId, organizationTable.id)
            )
            .where(eq(memberTable.userId, args.userId)),
        findOrganizationMembers: (args: TFindOrganizationMembers) =>
          db
            .select({
              id: memberTable.id,
              organizationId: memberTable.organizationId,
              userId: memberTable.userId,
              role: memberTable.role,
              createdAt: memberTable.createdAt,
              user: {
                id: userTable.id,
                name: userTable.name,
                email: userTable.email,
                image: userTable.image,
              },
            })
            .from(memberTable)
            .innerJoin(userTable, eq(memberTable.userId, userTable.id))
            .where(eq(memberTable.organizationId, args.organizationId)),
        findOrganizationInvitations: (args: TFindOrganizationInvitations) =>
          db
            .select({
              id: invitationTable.id,
              organizationId: invitationTable.organizationId,
              email: invitationTable.email,
              role: invitationTable.role,
              status: invitationTable.status,
              expiresAt: invitationTable.expiresAt,
              inviterId: invitationTable.inviterId,
              createdAt: invitationTable.createdAt,
            })
            .from(invitationTable)
            .where(
              and(
                eq(invitationTable.organizationId, args.organizationId),
                eq(invitationTable.status, "pending")
              )
            ),
        createInvitation: ({
          id,
          organizationId,
          email,
          role,
          inviterId,
          expiresAt,
        }: {
          id: string;
          organizationId: string;
          email: string;
          role: string;
          inviterId: string;
          expiresAt: Date;
        }) =>
          db
            .insert(invitationTable)
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
              id: invitationTable.id,
              organizationId: invitationTable.organizationId,
              email: invitationTable.email,
              role: invitationTable.role,
              status: invitationTable.status,
              expiresAt: invitationTable.expiresAt,
              inviterId: invitationTable.inviterId,
              createdAt: invitationTable.createdAt,
            }),
        updateMemberRole: (args: TUpdateMemberRole) =>
          db
            .update(memberTable)
            .set({
              role: args.role,
            })
            .where(
              and(
                eq(memberTable.id, args.memberId),
                eq(memberTable.organizationId, args.organizationId)
              )
            )
            .returning({
              id: memberTable.id,
              organizationId: memberTable.organizationId,
              userId: memberTable.userId,
              role: memberTable.role,
              createdAt: memberTable.createdAt,
            }),

        findMemberById: (args: TFindMemberById) =>
          db
            .select({
              id: memberTable.id,
              organizationId: memberTable.organizationId,
              userId: memberTable.userId,
              role: memberTable.role,
              createdAt: memberTable.createdAt,
            })
            .from(memberTable)
            .where(eq(memberTable.id, args.memberId))
            .pipe(Effect.map(EffectArray.get(0))),

        deleteMember: (args: TDeleteMember) =>
          db
            .delete(memberTable)
            .where(
              and(
                eq(memberTable.id, args.memberId),
                eq(memberTable.organizationId, args.organizationId)
              )
            ),
        cancelInvitation: ({
          organizationId,
          invitationId,
        }: {
          organizationId: string;
          invitationId: string;
        }) =>
          Effect.gen(function* () {
            yield* db
              .update(invitationTable)
              .set({
                status: "canceled",
              })
              .where(
                and(
                  eq(invitationTable.id, invitationId),
                  eq(invitationTable.organizationId, organizationId)
                )
              );
          }),
        findMemberByEmailInOrg: (args: TFindMemberByEmailInOrg) =>
          db
            .select({ id: memberTable.id })
            .from(memberTable)
            .innerJoin(userTable, eq(memberTable.userId, userTable.id))
            .where(
              and(
                eq(memberTable.organizationId, args.organizationId),
                eq(userTable.email, args.email)
              )
            )
            .pipe(Effect.map(EffectArray.get(0))),
        findOwnersInOrg: (args: TFindOwnersInOrg) =>
          db
            .select({ id: memberTable.id })
            .from(memberTable)
            .where(
              and(
                eq(memberTable.organizationId, args.organizationId),
                eq(memberTable.role, "owner")
              )
            ),
      };
    }),
  }
) {}
