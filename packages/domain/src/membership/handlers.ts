import { Effect, Layer } from "effect";
import { mapToInternalServerError } from "../rpc-errors";
import { CurrentSession } from "../session-middleware";
import { MembershipRepository } from "./repository";
import { MembershipRpcs } from "./rpcs";
import { randomUUID } from "node:crypto";

export const MembershipRpcHandlers = MembershipRpcs.toLayer(
  Effect.gen(function* () {
    const repository = yield* MembershipRepository;

    const requireOrganizationManager = (role: string) =>
      Effect.gen(function* () {
        if (!role.includes("owner") && !role.includes("admin")) {
          return yield* Effect.fail(new Error("Forbidden"));
        }
      });

    return {
      MembershipList: () => {
        return Effect.gen(function* () {
          const session = yield* CurrentSession;

          return yield* repository.findMany({
            userId: session.session.userId,
          });
        }).pipe(Effect.mapError(mapToInternalServerError()));
      },
      OrganizationMembersList: ({ organizationId }) =>
        Effect.gen(function* () {
          const session = yield* CurrentSession;

          const memberships = yield* repository.findMany({
            userId: session.session.userId,
          });
          if (
            !memberships.some((membership) => membership.organizationId === organizationId)
          ) {
            return yield* Effect.fail(new Error("Forbidden"));
          }

          return yield* repository.findOrganizationMembers({ organizationId });
        }).pipe(Effect.mapError(mapToInternalServerError())),
      OrganizationInvitationsList: ({ organizationId }) =>
        Effect.gen(function* () {
          const session = yield* CurrentSession;

          const memberships = yield* repository.findMany({
            userId: session.session.userId,
          });
          if (
            !memberships.some((membership) => membership.organizationId === organizationId)
          ) {
            return yield* Effect.fail(new Error("Forbidden"));
          }

          return yield* repository.findOrganizationInvitations({ organizationId });
        }).pipe(Effect.mapError(mapToInternalServerError())),
      OrganizationInviteMember: ({ organizationId, email, role }) =>
        Effect.gen(function* () {
          const session = yield* CurrentSession;
          const memberships = yield* repository.findMany({
            userId: session.session.userId,
          });
          const myMembership = memberships.find(
            (membership) => membership.organizationId === organizationId
          );
          if (!myMembership) {
            return yield* Effect.fail(new Error("Forbidden"));
          }

          yield* requireOrganizationManager(myMembership.role);

          const existingMember = yield* repository.findMemberByEmailInOrg({
            organizationId,
            email,
          });
          if (existingMember) {
            return yield* Effect.fail(new Error("User already a member"));
          }

          return yield* repository.createInvitation({
            id: randomUUID(),
            organizationId,
            email: email.toLowerCase(),
            role,
            inviterId: session.session.userId,
            expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 48),
          });
        }).pipe(Effect.mapError(mapToInternalServerError())),
      OrganizationUpdateMemberRole: ({ organizationId, memberId, role }) =>
        Effect.gen(function* () {
          const session = yield* CurrentSession;
          const memberships = yield* repository.findMany({
            userId: session.session.userId,
          });
          const myMembership = memberships.find(
            (membership) => membership.organizationId === organizationId
          );
          if (!myMembership) {
            return yield* Effect.fail(new Error("Forbidden"));
          }

          yield* requireOrganizationManager(myMembership.role);

          const existingMember = yield* repository.findMemberById({ memberId });
          if (!existingMember || existingMember.organizationId !== organizationId) {
            return yield* Effect.fail(new Error("Member not found"));
          }
          if (existingMember.role.includes("owner")) {
            return yield* Effect.fail(new Error("Owner role cannot be changed"));
          }

          const updatedMember = yield* repository.updateMemberRole({
            organizationId,
            memberId,
            role,
          });
          if (!updatedMember) {
            return yield* Effect.fail(new Error("Failed to update role"));
          }

          const withUser = yield* repository.findOrganizationMembers({
            organizationId,
          });
          const selected = withUser.find((member) => member.id === memberId);
          if (!selected) {
            return yield* Effect.fail(new Error("Member not found"));
          }

          return selected;
        }).pipe(Effect.mapError(mapToInternalServerError())),
      OrganizationRemoveMember: ({ organizationId, memberId }) =>
        Effect.gen(function* () {
          const session = yield* CurrentSession;
          const memberships = yield* repository.findMany({
            userId: session.session.userId,
          });
          const myMembership = memberships.find(
            (membership) => membership.organizationId === organizationId
          );
          if (!myMembership) {
            return yield* Effect.fail(new Error("Forbidden"));
          }

          yield* requireOrganizationManager(myMembership.role);

          const member = yield* repository.findMemberById({ memberId });
          if (!member || member.organizationId !== organizationId) {
            return yield* Effect.fail(new Error("Member not found"));
          }

          if (member.role.includes("owner")) {
            const hasOtherOwner = yield* repository.hasOtherOwner({
              organizationId,
              memberId,
            });
            if (!hasOtherOwner) {
              return yield* Effect.fail(new Error("Cannot remove only owner"));
            }
          }

          yield* repository.deleteMember({
            organizationId,
            memberId,
          });
        }).pipe(Effect.mapError(mapToInternalServerError())),
      OrganizationCancelInvitation: ({ organizationId, invitationId }) =>
        Effect.gen(function* () {
          const session = yield* CurrentSession;
          const memberships = yield* repository.findMany({
            userId: session.session.userId,
          });
          const myMembership = memberships.find(
            (membership) => membership.organizationId === organizationId
          );
          if (!myMembership) {
            return yield* Effect.fail(new Error("Forbidden"));
          }

          yield* requireOrganizationManager(myMembership.role);
          yield* repository.cancelInvitation({ organizationId, invitationId });
        }).pipe(Effect.mapError(mapToInternalServerError())),
    };
  })
).pipe(Layer.provide(MembershipRepository.Default));
