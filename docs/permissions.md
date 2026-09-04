# Shared permission system

Feeblo's permissions live in **one place** — `packages/permissions` — and are imported by both the backend (`packages/domain`) and the frontend (`packages/web-shared`, `apps/web`). The backend enforces them; the frontend uses the exact same definitions to show/hide UI, so the two can never drift.

## Why this exists

Permissions were previously defined twice, by hand, in two places:

- **Backend** — `packages/domain/src/policy.ts` plus per-module `*Policy` services, with ad-hoc `role === "owner" || role === "admin"` checks and a `role: "owner" | "admin" | "member"` literal duplicated across schemas.
- **Frontend** — `packages/web-shared/src/hooks/use-policy.ts` re-implemented the same vocabulary (`hasRole`, `hasOwnerOrAdminRole`, hardcoded literals) with no link to the backend definitions.

Because the two copies were independent, they drifted:

| # | Mismatch | Frontend said | Backend enforced | Result |
| --- | --- | --- | --- | --- |
| 1 | `hasRole(role)` had **no org scope** | "user is admin anywhere → show admin UI" | roles are always org-scoped | An admin of org A saw admin UI inside org B |
| 2 | Board menu gated by `hasOwnerOrAdminRole` | board creator (member) sees no menu | `BoardPolicy.canUpdate/canDelete` = manage **OR board creator** | UI hid actions the backend allows |
| 3 | Post lock/archive/merge gated by `canManagePost` (manage **or** author) | post author sees lock/merge | `PostAdminUpdate`/`PostMerge` = `posts.*` (manager+) | UI showed actions the backend rejects (403) |
| 4 | Changelog editor gated by creator-only | owner/admin sees read-only editor for others' entries | `ChangelogPolicy.canUpdate` = manage **or** creator | UI blocked actions the backend allows |
| 5 | Role literal duplicated | `"owner" \| "admin" \| "member"` typed by hand in ~6 places | same literal, hand-typed | Adding a role meant touching every site |

The shared system fixes all of these by construction.

## Model

Real-world feedback platforms use a two-layer model:

### Layer 1 — Role hierarchy

```text
owner > admin > manager > contributor
```

An administrative precedence order where higher roles inherit everything below them. Owner retains the highest legacy rank for ownership-transfer and invitation rules, while its effective capability set is identical to admin:

- **owner** — legacy workspace-owner designation; created with the workspace and never invited. It has the same effective permissions as admin.
- **admin** — unrestricted workspace administrator.
- **manager** — content manager: handles posts, changelogs, tags, roadmaps, and lower-ranked user cleanup (formerly the "member" role).
- **contributor** — contributes feedback: creates/votes/comments on posts.

`packages/permissions/src/roles.ts` is its single definition (`ROLES`, `ROLE_RANK`, `roleAtLeast`, `compareRoles`). Owner and admin are "privileged" — `PRIVILEGED_ROLES`/`isPrivilegedRole` are **derived** from the permission table via the `workspace.update` grant (admin directly, owner by inheritance), not a hardcoded role list; admin/manager/contributor can be invited (`INVITABLE_ROLES`).

### Predefined role matrix

Admin and owner are intentionally equivalent for authorization. `owner` is kept only for legacy workspace records. "Own" post/comment actions still require the resource-level authorship checks described below.

| Area | Capability | Contributor | Manager | Admin / Owner |
| --- | --- | :-: | :-: | :-: |
| Boards | Import posts | No | Yes | Yes |
| Boards | Export data to CSV | No | Yes | Yes |
| Boards | Customize the create-post form | No | Yes | Yes |
| Boards | Create or delete boards | No | No | Yes |
| Boards | Manage board privacy | No | No | Yes |
| Posts | Create a post | Yes | Yes | Yes |
| Posts | Create a post on behalf of a customer (`posts.createOnBehalf`) | No | Yes | Yes |
| Posts | Delete a newly-created own post | Yes | Yes | Yes |
| Posts | Change post tags | Yes | Yes | Yes |
| Posts | Move posts between boards | Yes | Yes | Yes |
| Posts | Manage tags | No | Yes | Yes |
| Posts | Change ETA, owner, or status | No | Yes | Yes |
| Posts | Manage categories | No | Yes | Yes |
| Posts | Merge or unmerge posts | No | Yes | Yes |
| Posts | Delete another user's post | No | Yes | Yes |
| Posts | Manage post fields | No | Yes | Yes |
| Votes | Vote for self or on behalf of another user (`votes.onBehalf`) | Yes | Yes | Yes |
| Comments | Create public or internal comments | Yes | Yes | Yes |
| Comments | Create a comment on behalf of a customer (`comments.createOnBehalf`) | No | Yes | Yes |
| Comments | Delete own comments | Yes | Yes | Yes |
| Comments | Delete another user's comments | No | Yes | Yes |
| Users | Delete users | No | Yes | Yes |
| Users | View user details | Yes | Yes | Yes |
| Roadmaps | Prioritize the roadmap | No | Yes | Yes |
| Changelog | Manage the changelog | No | Yes | Yes |
| Changelog | Manage changelog privacy | No | No | Yes |
| Developer | Manage API/SSO keys or webhooks | No | No | Yes |
| Settings | Manage post statuses | No | Yes | Yes |
| Settings | Manage authentication, billing, company profile, custom domains, email, or integrations | No | No | Yes |
| Settings | Manage teammates | No | No | Yes |
| Settings | Delete the workspace | No | No | Yes |

The matrix is the authorization contract, including capabilities planned for future product surfaces. Board import, CSV export, create-post-form customization, outbound webhook management, and configurable post fields or statuses are not currently shipped. They must receive distinct named permissions and matching backend/frontend gates when implemented; no existing generic permission should be reused for them.

### Layer 2 — Named permissions

Instead of scattering `role === "owner" || role === "admin"`, every gate is a **named permission**:

```text
boards.*             changelog.*         posts.*
comments.*           members.invite      members.remove
members.assign       site.*              roadmap.*
billing.*            contacts.*          companies.*
```

`packages/permissions/src/permissions.ts` is the catalog (id + label + description, anchored to the backend policy it maps to). Its `createPermissions(resource, actions)` utility creates the action permissions and the matching `{resource}.*` wildcard. `roleGrants` resolves a wildcard grant for action checks. `src/role-permissions.ts` is the role → permission table. Roles inherit permissions from lower ranks automatically (`permissionsForRole`).

### The `can()` API

Both sides call the same pure function:

```ts
// packages/permissions/src/can.ts
can(context, organizationId, permission) => boolean
```

`context` only needs `memberships: [{ organizationId, role }]` — both the backend `Session` and the frontend `AuthClientSession` satisfy it structurally.

- **Backend:** `Policy.canPermission(organizationId, "posts.*")` wraps `can()` in the Effect policy machinery.
- **Frontend:** `hasPermission(organizationId, "posts.*")` is a `ClientPolicy` over the same `can()`.

### Resource checks stay on the backend

"Can this actor edit THIS changelog?" needs data the frontend may not have. Two complementary rules:

1. The **role/permission part** comes from the shared table (never drifts).
2. The **resource part** ("is the actor the creator?") is composed in the backend policy and mirrored client-side **only when the resource data is already loaded** (e.g. `post.creatorId`, `board.creatorId`):

   ```ts
   // backend  ChangelogPolicy.canUpdate
   Policy.canPermission(orgId, "changelog.*");

   // frontend changelog-editor.tsx (same permission id)
   hasPermission(orgId, "changelog.*");
   ```

Plan entitlements (limits/capabilities) remain a separate, orthogonal layer — they gate _how much_ (board count, admin count), not _who may_. They already use the shared vocabulary (`isPrivilegedRole`, now permission-derived) for privileged-member limits.

## Package layout

```text
packages/permissions/
  src/roles.ts            Role union, rank, hierarchy helpers
  src/permissions.ts      Permission union + catalog (labels/descriptions)
  src/role-permissions.ts Role → permission table (with inheritance)
  src/can.ts              can()/canAny()/canAll()/roleIn()/isMember()
  src/index.ts            re-exports
```

Zero runtime dependencies — safe for Node (backend) and browsers (frontend).

## Role rename (member → manager) and contributor

The former `member` role was renamed to `manager` (same permissions) and a new lowest tier `contributor` was added:

| Role | Grants (beyond inheritance) |
| --- | --- |
| `contributor` | + `posts.move`, `votes.onBehalf`; other contribution actions use membership/resource policies |
| `manager` | + `members.remove`, `posts.*` (includes `posts.createOnBehalf`), `changelog.*`, `tags.*`, `roadmap.*`, `comments.*` (includes `comments.createOnBehalf`), CRM create/update |
| `admin` | + `workspace.*`, `members.*`, `billing.*`, `site.*`, `boards.*`, `contacts.*`, `companies.*` |
| `owner` | No additional grants; retained as a legacy alias of admin |

The DB `member.role` column is `text` (not an enum), so the rename is a data migration (`packages/db/src/migrations/20260805000000_rename_member_role_to_manager`) that updates `member` and `invitation` rows; the schema default now reads `manager`. All role literals across the repo flow from `ROLES` in `@feeblo/permissions`.

## Wiring

**Backend (`packages/domain`):**

- `policy.ts` — `hasMembership`/`hasOrganizationRole`/ `hasOrganizationOwnerOrAdmin`/`isMember` now delegate to `@feeblo/permissions`; new `canPermission(organizationId, permission)` for role gates. `hasOrganizationOwnerOrAdmin` is kept as an alias of `canPermission(orgId, "workspace.update")`.
- Module policies (`board`, `post`, `changelog`, `tag`, `site`, `contact`, `company`, `attribute-definition`, `membership`, `billing`, `roadmap`, `roadmap-column`) use `canPermission` with named permissions instead of role-literal checks.
- `membership/schema.ts` builds `ROLE_LITERAL` from `ROLES`.
- `plan-entitlements.ts` uses `PRIVILEGED_ROLES`/`isPrivilegedRole` from `@feeblo/permissions` directly (the old `PRIVILEGED_MEMBER_ROLES` / `isPrivilegedMemberRole` aliases were removed). `isPrivilegedRole` is derived from the permission table (`roleGrants(role, "workspace.update")`) rather than a hardcoded role list.
- The `member.role` / `invitation.role` columns in `packages/db` are typed `.$type<Role>()` / `.$type<Role | null>()`, so repository results stay assignable to the Effect schemas.

**Frontend (`packages/web-shared`):**

- `use-policy.ts` — new `hasPermission(organizationId, permission)` delegates to the shared `can()`; `hasRole` is now **org-scoped** (`hasRole(organizationId, role)`); `hasMembership`/`hasOwnerOrAdminRole` delegate to shared helpers. `usePolicy`/`PolicyGuard`/`allPolicy`/ `anyPolicy`/`isUser` unchanged.

**Mismatch fixes applied:**

1. `hasRole` is org-scoped (bug class removed).
2. Board lifecycle and privacy are available to admins and owners through `boards.create` and `boards.*`.
3. `post-sidebar-actions.tsx` — manager+ users can manage/moderate posts; contributors retain author-level post editing, with own-post deletion restricted to posts without comments or other votes.
4. `changelog-editor.tsx` — edit/delete/publish requires `changelog.*`.
5. Roadmap pages use `roadmap.*` instead of the generic owner/admin gate.
6. Managers can delete other users' comments through `comments.*`.

**Manager-only operations are enforced on the backend, not just in the UI.** The board/changelog/tag/contact/company create/update policies check named permissions instead of bare `hasMembership`, so direct RPC calls from a contributor are rejected with `PolicyDenied`. Frontend mirrors gate the same actions (`CreateBoardButton`, changelog “New Entry”, tag/contact/company rows) so contributors never see actions that would 403. `TagList` now returns `creatorId` so the tag rename/delete menu keeps the creator fallback, matching `TagPolicy.canUpdate`/`canDelete`.

## Rules of thumb for new code

- **Never write `role === "owner"`.** Add a permission to `role-permissions.ts` (and `permissions.ts` for its label) and gate with `Policy.canPermission` / `hasPermission`.
- **Never duplicate the role literal.** Import `Role` / `ROLES` from `@feeblo/permissions`.
- **Frontend gates must mirror a backend policy.** When a gate needs resource data the frontend lacks, either add the field to the RPC response (as was done for `board.creatorId`) or return a derived `canX` flag from the backend.
- **Entitlements are not permissions.** Plan limits stay in `plan-entitlements.ts`; they gate quantity, not identity.

## Migration checklist (remaining call sites)

- `apps/web/src/dashboard/routes/$organizationId/settings/*` still use the `hasOwnerOrAdminRole` convenience alias (works, maps to `workspace.update`). Prefer explicit permissions (`site.*`, `members.invite`/`members.remove`) when next touched.
- `members.tsx` parses `member.role.split(",")` from the DB — replace with a `Role`-typed mapper when the member collection schema is tightened.
- `packages/domain/src/policy.ts#hasOrganizationRole` remains exported for legacy call sites; prefer `canPermission` in new code.

## Renaming a role or adding one

This rename (member → manager + new contributor tier) touched every layer, and each step follows the same pattern:

1. `packages/permissions/src/roles.ts` — edit `ROLES`, `ROLE_RANK`, `INVITABLE_ROLES` (the only role-literal source).
2. `packages/permissions/src/role-permissions.ts` — assign permissions.
3. `packages/db/src/schema/auth.ts` — update the `member.role` column type and default; add a data migration for existing rows.
4. `packages/auth/src/organization-roles.ts` — mirror the role in better-auth's org-plugin ACL (server and client share this file, so the inferred invitation/member role types stay in sync).
5. Update UI labels/defaults in `settings/members.tsx` and e2e fixtures.

Because everything else imports `Role`/`ROLES`/`can()` from the shared package, no other consumer needs to change.
