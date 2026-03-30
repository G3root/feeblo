import { randomUUID } from "node:crypto";
import { Effect, Layer } from "effect";
import * as Policy from "../policy";
import { InternalServerError } from "../rpc-errors";
import { CurrentSession } from "../session-middleware";
import { MembershipPolicy } from "./policies";
import { MembershipRepository } from "./repository";
import { MembershipRpcs } from "./rpcs";

export const MembershipRpcHandlers = MembershipRpcs.toLayer(
  Effect.gen(function* () {
    const repository = yield* MembershipRepository;
    const membershipPolicy = yield* MembershipPolicy;
    return {
      MembershipList: () => {
        return Effect.gen(function* () {
          const session = yield* CurrentSession;

          return yield* repository.findMembershipsByUserId({
            userId: session.session.userId,
          });
        }).pipe(
          Effect.catchTags({
            SqlError: () =>
              Effect.fail(
                new InternalServerError({
                  message: "Failed to list members",
                })
              ),
          })
        );
      },
      OrganizationMembersList: ({ organizationId }) =>
        Effect.gen(function* () {
          return yield* repository.findOrganizationMembers({ organizationId });
        }).pipe(
          Policy.withPolicy(Policy.hasMembership(organizationId)),
          Effect.catchTags({
            SqlError: () =>
              Effect.fail(
                new InternalServerError({
                  message: "Failed to list members",
                })
              ),
          })
        ),
      OrganizationInvitationsList: ({ organizationId }) =>
        Effect.gen(function* () {
          return yield* repository.findOrganizationInvitations({
            organizationId,
          });
        }).pipe(
          Policy.withPolicy(Policy.hasMembership(organizationId)),
          Effect.catchTags({
            SqlError: () =>
              Effect.fail(
                new InternalServerError({
                  message: "Failed to list invitations",
                })
              ),
          })
        ),
      OrganizationInviteMember: ({ organizationId, email, role }) =>
        Effect.gen(function* () {
          const session = yield* CurrentSession;

          yield* repository.createInvitation({
            id: randomUUID(),
            organizationId,
            email: email.toLowerCase(),
            role,
            inviterId: session.session.userId,
            expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 48),
          });
        }).pipe(
          Policy.withPolicy(
            Policy.all(
              Policy.hasMembership(organizationId),
              Policy.any(Policy.hasRole("owner"), Policy.hasRole("admin")),
              membershipPolicy.isNotMember({ organizationId, email })
            )
          ),
          Effect.catchTags({
            SqlError: () =>
              Effect.fail(
                new InternalServerError({
                  message: "Failed to invite member",
                })
              ),
          })
        ),
      OrganizationUpdateMemberRole: ({ organizationId, memberId, role }) =>
        Effect.gen(function* () {
          yield* repository.updateMemberRole({
            organizationId,
            memberId,
            role,
          });
        }).pipe(
          Policy.withPolicy(
            Policy.all(
              Policy.hasMembership(organizationId),
              Policy.any(Policy.hasRole("owner"), Policy.hasRole("admin")),
              membershipPolicy.hasOtherOwners({ organizationId, memberId })
            )
          ),
          Effect.catchTags({
            SqlError: () =>
              Effect.fail(
                new InternalServerError({
                  message: "Failed to update member role",
                })
              ),
          })
        ),
      OrganizationRemoveMember: ({ organizationId, memberId }) =>
        Effect.gen(function* () {
          yield* repository.deleteMember({
            organizationId,
            memberId,
          });
        }).pipe(
          Policy.withPolicy(
            Policy.all(
              Policy.hasMembership(organizationId),
              Policy.any(Policy.hasRole("owner"), Policy.hasRole("admin")),
              membershipPolicy.hasOtherOwners({ organizationId, memberId })
            )
          ),
          Effect.catchTags({
            SqlError: () =>
              Effect.fail(
                new InternalServerError({
                  message: "Failed to remove member",
                })
              ),
          })
        ),
      OrganizationCancelInvitation: ({ organizationId, invitationId }) =>
        Effect.gen(function* () {
          yield* repository.cancelInvitation({ organizationId, invitationId });
        }).pipe(
          Policy.withPolicy(
            Policy.all(
              Policy.hasMembership(organizationId),
              Policy.any(Policy.hasRole("owner"), Policy.hasRole("admin"))
            )
          ),
          Effect.catchTags({
            SqlError: () =>
              Effect.fail(
                new InternalServerError({
                  message: "Failed to cancel invitation",
                })
              ),
          })
        ),
    };
  })
).pipe(
  Layer.provide(MembershipRepository.Default),
  Layer.provide(MembershipPolicy.Default)
);
