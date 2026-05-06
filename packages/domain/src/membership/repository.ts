import { Database, schema } from "@feeblo/db";
import { and, eq, inArray } from "drizzle-orm";
import { Context, Effect, Layer, Option } from "effect";
import { PRIVILEGED_MEMBER_ROLES } from "../plan-entitlements";

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

const makeMembershipRepository = Effect.gen(function* () {
  const db = yield* Database.Database;

  return {
    findMembershipsByUserId: (args: TFindMembershipsByUserId) =>
      db
        .makeQuery((execute, input: TFindMembershipsByUserId) =>
          execute((client) =>
            client
              .select({
                id: schema.member.id,
                organizationId: schema.member.organizationId,
                userId: schema.member.userId,
                role: schema.member.role,
                createdAt: schema.member.createdAt,
              })
              .from(schema.member)
              .where(eq(schema.member.userId, input.userId))
          )
        )(args),
    findOrganizationMembers: (args: TFindOrganizationMembers) =>
      db.makeQuery((execute, input: TFindOrganizationMembers) =>
        execute((client) =>
          client.select({
            id: schema.member.id,
            organizationId: schema.member.organizationId,
            userId: schema.member.userId,
            role: schema.member.role,
            createdAt: schema.member.createdAt,
            user: {
              id: schema.user.id,
              name: schema.user.name,
              email: schema.user.email,
              image: schema.user.image,
            },
          })
          .from(schema.member)
          .innerJoin(schema.user, eq(schema.member.userId, schema.user.id))
          .where(eq(schema.member.organizationId, input.organizationId))
        )
      )(args),
    findOrganizationInvitations: (args: TFindOrganizationInvitations) =>
      db.makeQuery((execute, input: TFindOrganizationInvitations) =>
        execute((client) =>
          client.select({
            id: schema.invitation.id,
            organizationId: schema.invitation.organizationId,
            email: schema.invitation.email,
            role: schema.invitation.role,
            status: schema.invitation.status,
            expiresAt: schema.invitation.expiresAt,
            inviterId: schema.invitation.inviterId,
            createdAt: schema.invitation.createdAt,
          })
          .from(schema.invitation)
          .where(
            and(
              eq(schema.invitation.organizationId, input.organizationId),
              eq(schema.invitation.status, "pending")
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
    }: {
      id: string;
      organizationId: string;
      email: string;
      role: string;
      inviterId: string;
      expiresAt: Date;
    }) =>
      db.makeQuery((execute, input: {
        id: string;
        organizationId: string;
        email: string;
        role: string;
        inviterId: string;
        expiresAt: Date;
      }) =>
        execute((client) =>
          client.insert(schema.invitation).values({
            id: input.id,
            organizationId: input.organizationId,
            email: input.email,
            role: input.role,
            inviterId: input.inviterId,
            expiresAt: input.expiresAt,
            status: "pending",
            createdAt: new Date(),
          }).returning({
            id: schema.invitation.id,
            organizationId: schema.invitation.organizationId,
            email: schema.invitation.email,
            role: schema.invitation.role,
            status: schema.invitation.status,
            expiresAt: schema.invitation.expiresAt,
            inviterId: schema.invitation.inviterId,
            createdAt: schema.invitation.createdAt,
          })
        )
      )({ id, organizationId, email, role, inviterId, expiresAt }),
    updateMemberRole: (args: TUpdateMemberRole) =>
      db.makeQuery((execute, input: TUpdateMemberRole) =>
        execute((client) =>
          client
            .update(schema.member)
            .set({
              role: input.role,
            })
            .where(
              and(
                eq(schema.member.id, input.memberId),
                eq(schema.member.organizationId, input.organizationId)
              )
            )
            .returning({
              id: schema.member.id,
              organizationId: schema.member.organizationId,
              userId: schema.member.userId,
              role: schema.member.role,
              createdAt: schema.member.createdAt,
            })
        )
      )(args),

    findMemberById: (args: TFindMemberById) =>
      db
        .makeQuery((execute, input: TFindMemberById) =>
          execute((client) =>
            client
              .select({
                id: schema.member.id,
                organizationId: schema.member.organizationId,
                userId: schema.member.userId,
                role: schema.member.role,
                createdAt: schema.member.createdAt,
              })
              .from(schema.member)
              .where(eq(schema.member.id, input.memberId))
          )
        )(args)
        .pipe(Effect.map((rows) => Option.fromNullishOr(rows[0]))),

    deleteMember: (args: TDeleteMember) =>
      db.makeQuery((execute, input: TDeleteMember) =>
        execute((client) =>
          client.delete(schema.member).where(
            and(
              eq(schema.member.id, input.memberId),
              eq(schema.member.organizationId, input.organizationId)
            )
          )
        )
      )(args),
    cancelInvitation: ({
      organizationId,
      invitationId,
    }: {
      organizationId: string;
      invitationId: string;
    }) =>
      Effect.gen(function* () {
        yield* db.makeQuery(
          (execute, input: { organizationId: string; invitationId: string }) =>
            execute((client) =>
              client
                .update(schema.invitation)
                .set({
                  status: "canceled",
                })
                .where(
                  and(
                    eq(schema.invitation.id, input.invitationId),
                    eq(schema.invitation.organizationId, input.organizationId)
                  )
                )
            )
        )({ organizationId, invitationId });
      }),
    findMemberByEmailInOrg: (args: TFindMemberByEmailInOrg) =>
      db
        .makeQuery((execute, input: TFindMemberByEmailInOrg) =>
          execute((client) =>
            client
              .select({ id: schema.member.id })
              .from(schema.member)
              .innerJoin(schema.user, eq(schema.member.userId, schema.user.id))
              .where(
                and(
                  eq(schema.member.organizationId, input.organizationId),
                  eq(schema.user.email, input.email)
                )
              )
          )
        )(args)
        .pipe(Effect.map((rows) => Option.fromNullishOr(rows[0]))),
    findOwnersInOrg: (args: TFindOwnersInOrg) =>
      db.makeQuery((execute, input: TFindOwnersInOrg) =>
        execute((client) =>
          client
            .select({ id: schema.member.id })
            .from(schema.member)
            .where(
              and(
                eq(schema.member.organizationId, input.organizationId),
                eq(schema.member.role, "owner")
              )
            )
        )
      )(args),
    countPrivilegedMembers: ({ organizationId }: { organizationId: string }) =>
      Effect.gen(function* () {
        const members = yield* db.makeQuery(
          (execute, input: { organizationId: string }) =>
            execute((client) =>
              client
                .select({ id: schema.member.id })
                .from(schema.member)
                .where(
                  and(
                    eq(schema.member.organizationId, input.organizationId),
                    inArray(schema.member.role, [...PRIVILEGED_MEMBER_ROLES])
                  )
                )
            )
        )({ organizationId });

        return members.length;
      }),
    countPendingPrivilegedInvitations: ({
      organizationId,
    }: {
      organizationId: string;
    }) =>
      Effect.gen(function* () {
        const invitations = yield* db.makeQuery(
          (execute, input: { organizationId: string }) =>
            execute((client) =>
              client
                .select({ id: schema.invitation.id })
                .from(schema.invitation)
                .where(
                  and(
                    eq(schema.invitation.organizationId, input.organizationId),
                    eq(schema.invitation.status, "pending"),
                    inArray(
                      schema.invitation.role,
                      [...PRIVILEGED_MEMBER_ROLES]
                    )
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
