import { APIError as BetterAuthApiError } from "better-call";
import { Effect, Layer } from "effect";
import * as Policy from "../policy";
import {
  BadRequestError,
  InternalServerError,
  UnauthorizedError,
} from "../rpc-errors";
import { Auth, CurrentSession } from "../session-middleware";
import { MembershipPolicy } from "./policies";
import { MembershipRepository } from "./repository";
import { MembershipRpcs } from "./rpcs";

const SESSION_COOKIE_KEY = "better-auth.session_token";

const toSessionHeaders = (token: string) =>
  new Headers({
    cookie: `${SESSION_COOKIE_KEY}=${encodeURIComponent(token)}`,
  });

const toMembershipError = (error: unknown, fallbackMessage: string) => {
  if (error instanceof BetterAuthApiError) {
    const message = error.body?.message ?? fallbackMessage;

    if (error.statusCode === 401) {
      return new UnauthorizedError({ message });
    }

    if (
      error.statusCode === 400 ||
      error.statusCode === 403 ||
      error.statusCode === 404 ||
      error.statusCode === 409 ||
      error.statusCode === 422
    ) {
      return new BadRequestError({ message });
    }

    return new InternalServerError({ message });
  }

  return new InternalServerError({ message: fallbackMessage });
};

export const MembershipRpcHandlers = MembershipRpcs.toLayer(
  Effect.gen(function* () {
    const repository = yield* MembershipRepository;
    const membershipPolicy = yield* MembershipPolicy;
    const auth = yield* Auth;

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

          yield* Effect.tryPromise({
            try: () =>
              auth.api.createInvitation({
                headers: toSessionHeaders(session.session.token),
                body: {
                  organizationId,
                  email: email.toLowerCase(),
                  role,
                },
              }),
            catch: (error) =>
              toMembershipError(error, "Failed to invite member"),
          });
        }).pipe(
          Policy.withPolicy(
            Policy.all(
              Policy.hasMembership(organizationId),
              Policy.any(Policy.hasRole("owner"), Policy.hasRole("admin"))
            )
          )
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
        repository.cancelInvitation({ organizationId, invitationId }).pipe(
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
  Layer.provide(MembershipRepository.layer),
  Layer.provide(MembershipPolicy.layer)
);
