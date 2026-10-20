import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";

/**
 * The member mutations the dashboard owns.
 *
 * Better Auth's organization plugin registers `update-member-role` and
 * `remove-member` as HTTP routes, and authorizes them with the organization ACL
 * alone. That ACL grants `admin` the `member: ["update", "delete"]` statements,
 * which is coarser than Feeblo's rule: an actor may only manage a member ranked
 * strictly below them (`canManageMember` in `MembershipPolicy`). A peer admin
 * can therefore demote or remove another admin through the plugin route even
 * though `UpdateOrganizationMemberRole` / `RemoveOrganizationMember` refuse it.
 *
 * The dashboard is the only member-management surface — the members page calls
 * the RPCs, never these plugin routes — and duplicating the rank rule in a
 * second implementation would let the two drift. The routes are disabled
 * instead, so every member mutation goes through the domain RPCs where
 * membership, permission, rank, last-owner, and plan entitlements are one set
 * of policies.
 *
 * Invitations (`invite-member`, `cancel-invitation`) and self-service routes
 * (`leave-organization`, `accept-invitation`, `reject-invitation`) stay as the
 * plugin implements them: they are either ACL-only in the domain too or act on
 * the caller's own membership.
 */
export const DASHBOARD_OWNED_MEMBER_ROUTES: readonly string[] = [
  "/organization/update-member-role",
  "/organization/remove-member",
];

export const MEMBER_MUTATION_ROUTE_DISABLED =
  "MEMBER_MUTATION_ROUTE_DISABLED" as const;

/**
 * Refuses the organization plugin's member mutations with a named error code.
 *
 * A `hooks.before` plugin rather than an `organizationHooks` callback: the
 * organization hooks for these operations do not receive the acting session,
 * so they cannot evaluate a rank rule, and there is no other seam that runs
 * before Better Auth mutates the member row.
 */
export const memberManagementGuard = (): BetterAuthPlugin => ({
  id: "member-management-guard",
  hooks: {
    before: [
      {
        matcher: (ctx) =>
          ctx.path !== undefined &&
          DASHBOARD_OWNED_MEMBER_ROUTES.includes(ctx.path),
        handler: createAuthMiddleware(async () => {
          throw APIError.from("FORBIDDEN", {
            code: MEMBER_MUTATION_ROUTE_DISABLED,
            message:
              "Manage workspace members from the dashboard. This route is disabled because it bypasses the workspace's member policies.",
          });
        }),
      },
    ],
  },
});
