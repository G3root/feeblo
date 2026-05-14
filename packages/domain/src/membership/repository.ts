import { Database, schema } from "@feeblo/db";
import { and, eq, inArray } from "drizzle-orm";
import { Context, Effect, Array as EffectArray, Layer } from "effect";
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
  const db = yield* Database.Database;

  return {
    findMembershipsByUserId: (args: TFindMembershipsByUserId) =>
      db.makeQuery((execute, input: TFindMembershipsByUserId) =>
        execute((client) =>
          client
            .select({
              id: schema.memberTable.id,
              organizationId: schema.memberTable.organizationId,
              userId: schema.memberTable.userId,
              role: schema.memberTable.role,
              createdAt: schema.memberTable.createdAt,
            })
            .from(schema.memberTable)
            .where(eq(schema.memberTable.userId, input.userId))
        )
      )(args),
    findOrganizationMembers: (args: TFindOrganizationMembers) =>
      db.makeQuery((execute, input: TFindOrganizationMembers) =>
        execute((client) =>
          client
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
            .where(eq(schema.memberTable.organizationId, input.organizationId))
        )
      )(args),
    findOrganizationInvitations: (args: TFindOrganizationInvitations) =>
      db.makeQuery((execute, input: TFindOrganizationInvitations) =>
        execute((client) =>
          client
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
                eq(schema.invitationTable.organizationId, input.organizationId),
                eq(schema.invitationTable.status, "pending")
              )
            )
        )
      )(args),
    createInvitation: ({
      id,
      organizationId,
      email,
      role,
      inviterId,
      expiresAt,
    }: TCreateInvitation) =>
      db.makeQuery((execute, input: TCreateInvitation) =>
        execute((client) =>
          client
            .insert(schema.invitationTable)
            .values({
              id: input.id,
              organizationId: input.organizationId,
              email: input.email,
              role: input.role,
              inviterId: input.inviterId,
              expiresAt: input.expiresAt,
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
            })
        )
      )({ id, organizationId, email, role, inviterId, expiresAt }),
    updateMemberRole: (args: TUpdateMemberRole) =>
      db
        .makeQuery((execute, input: TUpdateMemberRole) =>
          execute((client) =>
            client
              .update(schema.memberTable)
              .set({
                role: input.role,
              })
              .where(
                and(
                  eq(schema.memberTable.id, input.memberId),
                  eq(schema.memberTable.organizationId, input.organizationId)
                )
              )
              .returning({
                id: schema.memberTable.id,
                organizationId: schema.memberTable.organizationId,
                userId: schema.memberTable.userId,
                role: schema.memberTable.role,
                createdAt: schema.memberTable.createdAt,
              })
          )
        )(args)
        .pipe(Effect.asVoid),

    findMemberById: (args: TFindMemberById) =>
      db
        .makeQuery((execute, input: TFindMemberById) =>
          execute((client) =>
            client
              .select({
                id: schema.memberTable.id,
                organizationId: schema.memberTable.organizationId,
                userId: schema.memberTable.userId,
                role: schema.memberTable.role,
                createdAt: schema.memberTable.createdAt,
              })
              .from(schema.memberTable)
              .where(eq(schema.memberTable.id, input.memberId))
          )
        )(args)
        .pipe(Effect.map(EffectArray.get(0))),

    deleteMember: (args: TDeleteMember) =>
      db
        .makeQuery((execute, input: TDeleteMember) =>
          execute((client) =>
            client
              .delete(schema.memberTable)
              .where(
                and(
                  eq(schema.memberTable.id, input.memberId),
                  eq(schema.memberTable.organizationId, input.organizationId)
                )
              )
          )
        )(args)
        .pipe(Effect.asVoid),
    cancelInvitation: ({ organizationId, invitationId }: TCancelInvitation) =>
      db
        .makeQuery((execute, input: TCancelInvitation) =>
          execute((client) =>
            client
              .update(schema.invitationTable)
              .set({
                status: "canceled",
              })
              .where(
                and(
                  eq(schema.invitationTable.id, input.invitationId),
                  eq(
                    schema.invitationTable.organizationId,
                    input.organizationId
                  )
                )
              )
          )
        )({ organizationId, invitationId })
        .pipe(Effect.asVoid),
    findMemberByEmailInOrg: (args: TFindMemberByEmailInOrg) =>
      db
        .makeQuery((execute, input: TFindMemberByEmailInOrg) =>
          execute((client) =>
            client
              .select({ id: schema.memberTable.id })
              .from(schema.memberTable)
              .innerJoin(
                schema.userTable,
                eq(schema.memberTable.userId, schema.userTable.id)
              )
              .where(
                and(
                  eq(schema.memberTable.organizationId, input.organizationId),
                  eq(schema.userTable.email, input.email)
                )
              )
          )
        )(args)
        .pipe(Effect.map(EffectArray.get(0))),
    findOwnersInOrg: (args: TFindOwnersInOrg) =>
      db.makeQuery((execute, input: TFindOwnersInOrg) =>
        execute((client) =>
          client
            .select({ id: schema.memberTable.id })
            .from(schema.memberTable)
            .where(
              and(
                eq(schema.memberTable.organizationId, input.organizationId),
                eq(schema.memberTable.role, "owner")
              )
            )
        )
      )(args),
    countPrivilegedMembers: ({ organizationId }: TCountByOrganizationId) =>
      Effect.gen(function* () {
        const members = yield* db.makeQuery(
          (execute, input: TCountByOrganizationId) =>
            execute((client) =>
              client
                .select({ id: schema.memberTable.id })
                .from(schema.memberTable)
                .where(
                  and(
                    eq(schema.memberTable.organizationId, input.organizationId),
                    inArray(schema.memberTable.role, [
                      ...PRIVILEGED_MEMBER_ROLES,
                    ])
                  )
                )
            )
        )({ organizationId });

        return members.length;
      }),
    countPendingPrivilegedInvitations: ({
      organizationId,
    }: TCountByOrganizationId) =>
      Effect.gen(function* () {
        const invitations = yield* db.makeQuery(
          (execute, input: TCountByOrganizationId) =>
            execute((client) =>
              client
                .select({ id: schema.invitationTable.id })
                .from(schema.invitationTable)
                .where(
                  and(
                    eq(
                      schema.invitationTable.organizationId,
                      input.organizationId
                    ),
                    eq(schema.invitationTable.status, "pending"),
                    inArray(schema.invitationTable.role, [
                      ...PRIVILEGED_MEMBER_ROLES,
                    ])
                  )
                )
            )
        )({ organizationId });

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
