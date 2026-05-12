import { APIError as BetterAuthApiError } from "better-auth";
import { Effect, Layer } from "effect";
import * as Policy from "../policy";
import {
  BadRequestError,
  InternalServerError,
  UnauthorizedError,
  withRemapDbErrors,
} from "../rpc-errors";
import { getSessionCookieName } from "../session-cookie";
import { Auth, CurrentSession } from "../session-middleware";
import { WorkspaceRepository } from "../workspace/repository";
import { MembershipPolicy } from "./policies";
import { MembershipRepository } from "./repository";
import { MembershipRpcs } from "./rpcs";

const SESSION_COOKIE_KEY = getSessionCookieName();

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
        }).pipe(withRemapDbErrors("Membership", "select"));
      },
      OrganizationMembersList: ({ organizationId }) =>
        repository.findOrganizationMembers({ organizationId }).pipe(
          Policy.withPolicy(Policy.hasMembership(organizationId)),
          withRemapDbErrors("Membership", "select")
        ),
      OrganizationInvitationsList: ({ organizationId }) =>
        repository.findOrganizationInvitations({
          organizationId,
        }).pipe(
          Policy.withPolicy(Policy.hasMembership(organizationId)),
          withRemapDbErrors("Invitation", "select")
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

          return;
        }).pipe(
          Policy.withPolicy(
            Policy.all(
              Policy.hasMembership(organizationId),
              Policy.any(
                Policy.hasOrganizationRole(organizationId, "owner"),
                Policy.hasOrganizationRole(organizationId, "admin")
              )
            )
          )
        ),
      OrganizationUpdateMemberRole: ({ organizationId, memberId, role }) =>
        repository
          .updateMemberRole({
            organizationId,
            memberId,
            role,
          })
          .pipe(
          Policy.withPolicy(
            Policy.all(
              Policy.hasMembership(organizationId),
              Policy.any(
                Policy.hasOrganizationRole(organizationId, "owner"),
                Policy.hasOrganizationRole(organizationId, "admin")
              ),
              membershipPolicy.hasOtherOwners({ organizationId, memberId })
            )
          ),
          withRemapDbErrors("Membership", "update")
          ),
      OrganizationRemoveMember: ({ organizationId, memberId }) =>
        repository
          .deleteMember({
            organizationId,
            memberId,
          })
          .pipe(
          Policy.withPolicy(
            Policy.all(
              Policy.hasMembership(organizationId),
              Policy.any(
                Policy.hasOrganizationRole(organizationId, "owner"),
                Policy.hasOrganizationRole(organizationId, "admin")
              ),
              membershipPolicy.hasOtherOwners({ organizationId, memberId })
            )
          ),
          withRemapDbErrors("Membership", "delete")
          ),
      OrganizationCancelInvitation: ({ organizationId, invitationId }) =>
        repository
          .cancelInvitation({ organizationId, invitationId })
          .pipe(
            Policy.withPolicy(
              Policy.all(
                Policy.hasMembership(organizationId),
                Policy.any(
                  Policy.hasOrganizationRole(organizationId, "owner"),
                  Policy.hasOrganizationRole(organizationId, "admin")
                )
              )
            ),
            withRemapDbErrors("Invitation", "update")
          ),
    };
  })
).pipe(
  Layer.provide(MembershipPolicy.layer),
  Layer.provide(MembershipRepository.layer),
  Layer.provide(WorkspaceRepository.layer)
);
