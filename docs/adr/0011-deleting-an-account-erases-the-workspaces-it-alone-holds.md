# ADR 0011: Deleting an account erases the workspaces it alone holds

## Decision

`user.deleteUser.enabled` is on, and the dashboard's profile Danger Zone calls `/delete-user`. Better Auth's own gates are untouched: a credential account supplies its password, and a social account needs a session fresh enough to satisfy `session.freshAge`.

`beforeDelete` is the data decision. It lists the workspaces the departing user owns and splits them by membership:

- A workspace where the user is the **only member** is deleted with the account, after its Polar subscription is cancelled, so the organization row and everything cascading from it — boards, posts, comments, integrations, API keys, subscriptions — goes too.
- A workspace that still has **other members** refuses the deletion, naming the workspace in the error. Nothing is deleted in that case; the user removes the other members or deletes the workspace first.

A "Delete workspace" action now exists in Workspace settings for the deliberate case, and it calls Better Auth's `/organization/delete` endpoint rather than deleting the row directly, so `organizationHooks.beforeDeleteOrganization` keeps owning the Polar cancellation.

## Why

The account row cascades: `member`, `session`, `account`, `invitation.inviterId`, `two_factor` and the notification inbox all reference `user` with `onDelete: cascade`, and the attribution columns (`post.creatorId`, `comment.actorId`, `asset.userId`, `email_contact.userId`) are `set null` or `cascade` by design. The organization row has no such path from the user. Before this change, an owner who deleted their account would have left a workspace reachable by nobody — no read, no delete, and a live Polar subscription still charging them. That is the failure the switch on `deleteUser` was hiding: the endpoint was disabled, so the dead button and the incomplete erasure were the same defect seen from two sides.

The split is the whole argument. A workspace with one member _is_ the account's data, so erasing the account and leaving the workspace would be an incomplete erasure, and refusing would have made the right to erasure conditional on a second destructive action the user had no surface for. A workspace with other members is the opposite: deleting it as a side effect of one person's request destroys data that belongs to people who never asked for anything, and no confirmation dialog can honestly obtain their consent. So the org survives, and the operation that would destroy it stays behind an explicit, workspace-named action.

The alternative — refuse while any workspace is owned, delete everything only through Workspace settings — was rejected for a mechanical reason. Account settings are org-scoped, and an account with no workspace left is sent to `/register` by the dashboard guard, so the page that holds the delete button would be unreachable exactly when it was needed. The register page now resumes a `redirectTo` deep link after creating the workspace (the guard already preserved one), which closes the loop for a user who deletes their last workspace first, but the one-step path from the profile page is what keeps a solo user's erasure from depending on that detour.

Two smaller choices are deliberate. Cancellation precedes the row delete because the external subscription id lives on the cascaded `subscription` row — the same ordering, and the same best-effort tolerance, as the existing `beforeDeleteOrganization` hook. And `beforeDelete` writes rather than only validating, because Better Auth deletes the user before `afterDelete` runs, so by then the `member` rows that name the owned workspaces are already gone.

## Consequences

Deletion is now a two-part invariant that a future change can break silently: the account deletion contract is "the account's own rows plus the workspaces it alone holds", and neither half is visible in the schema. `e2e/tests/account-deletion.spec.ts` pins all three paths — sole owner erases both and can no longer sign in, an owner with a teammate is refused with the workspace named, and the workspace action deletes a workspace on its own.

The refusal message and the dialog it appears in point at Members settings, because removing the other members is what makes an owned workspace deletable with the account without destroying anyone else's data. The check is "any other member", not "any other owner": a second owner does not by itself satisfy it, so the rule fails closed even where an administrator would in fact remain.

Workspaces deleted this way are irreversible in the same way the existing organization hook already was, and the e2e test asserts the observable consequence (the account can no longer sign in) rather than the row counts, so the assertion survives a schema change that keeps the guarantee.
