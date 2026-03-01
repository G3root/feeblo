import { DB } from "@feeblo/db";
import {
  invitation as invitationTable,
  member as memberTable,
  organization as organizationTable,
  user as userTable,
} from "@feeblo/db/schema/auth";
import { and, eq, ne } from "drizzle-orm";
import { Effect } from "effect";

export class MembershipRepository extends Effect.Service<MembershipRepository>()(
  "MembershipRepository",
  {
    effect: Effect.gen(function* () {
      const db = yield* DB;

      return {
        findMany: ({ userId }: { userId: string }) =>
          Effect.gen(function* () {
            const rows = yield* db
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
              .where(eq(memberTable.userId, userId));

            return rows;
          }),
        findOrganizationMembers: ({
          organizationId,
        }: {
          organizationId: string;
        }) =>
          Effect.gen(function* () {
            const rows = yield* db
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
              .where(eq(memberTable.organizationId, organizationId));

            return rows;
          }),
        findOrganizationInvitations: ({
          organizationId,
        }: {
          organizationId: string;
        }) =>
          Effect.gen(function* () {
            const rows = yield* db
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
                  eq(invitationTable.organizationId, organizationId),
                  eq(invitationTable.status, "pending")
                )
              );

            return rows;
          }),
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
          Effect.gen(function* () {
            const [invitation] = yield* db
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
              });

            if (!invitation) {
              return yield* Effect.fail(new Error("Failed to create invitation"));
            }

            return invitation;
          }),
        updateMemberRole: ({
          organizationId,
          memberId,
          role,
        }: {
          organizationId: string;
          memberId: string;
          role: string;
        }) =>
          Effect.gen(function* () {
            const [member] = yield* db
              .update(memberTable)
              .set({
                role,
              })
              .where(
                and(
                  eq(memberTable.id, memberId),
                  eq(memberTable.organizationId, organizationId)
                )
              )
              .returning({
                id: memberTable.id,
                organizationId: memberTable.organizationId,
                userId: memberTable.userId,
                role: memberTable.role,
                createdAt: memberTable.createdAt,
              });

            return member;
          }),
        findMemberById: ({ memberId }: { memberId: string }) =>
          Effect.gen(function* () {
            const [member] = yield* db
              .select({
                id: memberTable.id,
                organizationId: memberTable.organizationId,
                userId: memberTable.userId,
                role: memberTable.role,
                createdAt: memberTable.createdAt,
              })
              .from(memberTable)
              .where(eq(memberTable.id, memberId));

            return member;
          }),
        deleteMember: ({
          organizationId,
          memberId,
        }: {
          organizationId: string;
          memberId: string;
        }) =>
          Effect.gen(function* () {
            yield* db
              .delete(memberTable)
              .where(
                and(
                  eq(memberTable.id, memberId),
                  eq(memberTable.organizationId, organizationId)
                )
              );
          }),
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
        findMemberByEmailInOrg: ({
          organizationId,
          email,
        }: {
          organizationId: string;
          email: string;
        }) =>
          Effect.gen(function* () {
            const [member] = yield* db
              .select({ id: memberTable.id })
              .from(memberTable)
              .innerJoin(userTable, eq(memberTable.userId, userTable.id))
              .where(
                and(
                  eq(memberTable.organizationId, organizationId),
                  eq(userTable.email, email)
                )
              );
            return member;
          }),
        hasOtherOwner: ({
          organizationId,
          memberId,
        }: {
          organizationId: string;
          memberId: string;
        }) =>
          Effect.gen(function* () {
            const [owner] = yield* db
              .select({ id: memberTable.id })
              .from(memberTable)
              .where(
                and(
                  eq(memberTable.organizationId, organizationId),
                  eq(memberTable.role, "owner"),
                  ne(memberTable.id, memberId)
                )
              );
            return Boolean(owner);
          }),
      };
    }),
  }
) {}
