# Capping a free owner at three workspaces

**Question.** How do we restrict a "free" user who owns workspaces to creating only 3 workspaces?

**Date.** 2026-10-06. Read at commit `8ffd19c9` (`main`, clean tree). Line numbers are from that commit and will drift.

**Method.** Read the creation path, the plan/limit machinery, the better-auth organization wiring, the affected tests, and the client error handling. No code was changed. This is implementation research; the plan semantics below are a product decision, not a finding.

---

## Short answer

Workspace creation does **not** go through better-auth's organization plugin. It is one domain RPC:

`apps/web` `/register` → `WorkspaceRpcs.WorkspaceCreate` → `WorkspaceRpcHandlersEffect` → `WorkspaceRepository.createWorkspace` (`packages/domain/src/workspace/handlers.ts:24`, `packages/domain/src/workspace/repository.ts:87`). Nothing in that path counts how many workspaces the caller already owns, so today the cap is unbounded.

The limit belongs in that path, following the pattern the repo already uses for every other count-based plan limit (CRM entries, changelog categories, admin roles): a count query, a `PolicyDeniedError` with a reason, and a row lock so a concurrent count cannot be trusted. Concretely:

1. Add `workspaces` to the plan-entitlements catalog with `free: 3`, `starter/professional: null`.
2. Add `lockUser(userId)` + an "organizations this user owns" query to `WorkspaceRepository`.
3. Add `packages/domain/src/workspace/policies.ts` with `canCreateWorkspace({ userId })`.
4. Call it inside the existing `transaction(...)` in `WorkspaceCreate`, after `lockUser`.
5. Provide the policy in `WorkspaceRpcHandlers` and in the handler test layer.
6. Surface the denial on `/register` (`parseRpcError`), because `PolicyDenied` already reaches the UI.
7. Update the hand-authored pricing rows and the exact-value tests that will otherwise fail.

Before writing any of it, decide what "free" means for a user — plan is per workspace in this codebase, so "free user" is not a stored fact. See [The decision nobody has made yet](#the-decision-nobody-has-made-yet).

---

## The creation path, precisely

| Step | Source |
| --- | --- |
| Register page calls `fetchRpc((rpc) => rpc.WorkspaceCreate({ workspaceName }))` | `apps/web/src/routes/_dashboard/register.tsx:40` |
| Workspace switcher's "Create workspace" navigates to `/register` | `apps/web/src/dashboard/components/common/workspace-switcher.tsx:81` |
| The dashboard guard lets signed-in users with workspaces stay on `/register` (`DASHBOARD_NON_ORG_PATHS`) | `apps/web/src/dashboard/lib/auth-redirects.ts:57` |
| RPC contract: `WorkspaceCreate` with `AuthMiddleware`, errors include `PolicyDeniedError` | `packages/domain/src/workspace/rpcs.ts:16`, `packages/domain/src/workspace/errors.ts` |
| Handler: validates subdomain, checks subdomain availability inside `transaction(...)`, calls `repository.createWorkspace` | `packages/domain/src/workspace/handlers.ts:24-59` |
| Repository: inserts organization + `owner` member row + default tags/statuses/categories/roadmap/boards/site | `packages/domain/src/workspace/repository.ts:87-215` |

better-auth's `/organization/create` route is disabled for users (`allowUserToCreateOrganization: false`, `packages/auth/src/server.ts:830`), and no production code calls `organization.create`. The only test plugin that could create organizations is `testUtils`, mounted only when `isTest` (`packages/auth/src/server.ts:78`, `:940`). So `WorkspaceCreate` is the single user-reachable creation path; a check there is complete.

The `WorkspaceRepository` already owns the plan lookup: `findPlanByOrganizationId` resolves a workspace's plan from `subscription` ⨝ `product` (active/trialing, or `past_due` before `currentPeriodEnd`; otherwise `"free"`) — `packages/domain/src/workspace/repository.ts:257-296`.

---

## The decision nobody has made yet

> **Decision (2026-10-06): Option A.** Implemented in `docs/workspace-creation-limit-plan.md`; recorded in `docs/adr/0013-a-free-owner-owns-at-most-three-free-workspaces.md`. The options below are kept as the reasoning that led there.

There is **no user-level plan**. `plan` is a property of an organization, derived from its subscription (`findPlanByOrganizationId`), and a newly created workspace has no subscription, so it is `"free"` by definition. "Free user" therefore has to be defined by us. Three coherent readings:

**Option A — cap free workspaces owned (recommended).** A user may own at most `PLAN_ENTITLEMENTS.free.limits.workspaces` **free** workspaces. Paid workspaces do not count toward the cap, but they do not raise it either: 3 free + 1 paid still means the next free create is the fourth free one and is denied; upgrading one of the three frees a slot. This preserves the anti-farming intent (the free plan's per-workspace giveaways — 2 boards, 10 CRM entries, etc. — cannot be multiplied past 3) while never charging a paying customer for owned capacity they bought by upgrading.

**Option B — cap total owned, lifted by any paid workspace.** A user may own 3 workspaces total unless at least one owned workspace is paid, in which case there is no cap. Simplest to explain ("Free accounts: 3 workspaces. Paid: unlimited."), but one paid workspace buys unlimited free workspaces, which reopens the farming hole.

**Option C — hard cap total owned at 3 regardless of plan.** Reject: it blocks a paying customer from a 4th workspace on a plan they upgraded for, and no entitlement key can express it sensibly.

### Worked example: what one paid workspace buys

With the free cap at 3, for a user who owns **one paid workspace**:

| Owned free workspaces | Option A | Option B | Option C |
| --- | --- | --- | --- |
| 0 | can create 3 more | unlimited | can create 2 more |
| 2 | can create 1 more | unlimited | blocked |
| 3 | blocked; upgrading one of the free workspaces frees a slot | unlimited | blocked |

The distinction that matters: under Option B one subscription unlocks unlimited **free** workspaces — the farming hole the cap exists to close. Under Option A a paid workspace is simply not counted; it buys capacity only for itself, and the invariant "free workspaces owned ≤ 3" holds at all times. Option A still lets a user keep going by upgrading workspaces one at a time (upgrade frees a slot → create → upgrade → …), which is pay-per-workspace and presumably intended. Under Option A total owned workspaces are therefore unbounded only in the number of _paid_ ones.

Two smaller decisions either way:

- **Owner, not member.** The question says "owner", and member rows can carry a comma-joined role (`membership.role.split(",").includes("owner")` is the existing ownership test for account deletion, `packages/auth/src/server.ts:357-359`). Count organizations where the role list contains `owner`; a user who merely belongs to 10 workspaces is unrestricted.
- **Whose rows.** The count is per _user id_, not per workspace, so it must run inside the create transaction (below) — reading it under the row lock is what makes it authoritative.

This is a money/limits change. Per `AGENTS.md` ("Boundaries and sign-off") it needs owner sign-off before implementation.

---

## Why not better-auth's own `organizationLimit`

better-auth supports exactly this option — `organizationLimit?: number | ((user) => Awaitable<boolean>)` (`node_modules/better-auth/dist/plugins/organization/types.d.mts:38`), enforced in the create-organization route (`node_modules/better-auth/dist/plugins/organization/routes/crud-org.mjs:61`). It cannot be used here:

- The route is disabled (`allowUserToCreateOrganization: false`), and creation happens in the domain, so the option would never run.
- Re-enabling it would move creation back to better-auth, which does not seed the tags, statuses, categories, roadmap, boards, and site row that `createWorkspace` does.
- Its count is `adapter.listOrganizations(user.id)` — **memberships**, not owned workspaces, so it answers a different question.
- Its function form receives only `user`; determining a plan would need queries the plugin does not run, outside the app's transaction and lock discipline.

Mentioning it in the PR as "considered, not used" is enough.

---

## Recommended implementation (Option A)

### 1. Entitlement catalog — `packages/domain/src/plan-entitlements.ts`

Add `workspaces` to `LimitFeatureKey`, `PLAN_FEATURE_CATALOG` (kind `limit`, `"Workspace"`/`"Workspaces"`), and `LIMIT_FEATURE_ORDER`; set `free.limits.workspaces = 3`, `starter`/`professional` to `null`.

```ts
export type LimitFeatureKey =
  | "feedbackBoards"
  | "privilegedMembers"
  | "changelogCategories"
  | "submissionNotificationRecipients"
  | "crmEntries"
  | "workspaces";
```

The type-level guards make this self-enforcing: `PlanLimits = Record<LimitFeatureKey, number | null>` forces every plan to declare the key, and `LIMIT_FEATURE_ORDER` (`defineFeatureOrder<LimitFeatureKey>()`) forces exactly one entry in the order array. `getPlanFeatureRows` then renders `"3 Workspaces"` / `"Unlimited Workspaces"` for free.

This keeps the limit in the one catalog that already drives pricing copy and `useEntitlements` (`apps/web/src/dashboard/hooks/use-entitlements.ts`). The alternative — a bare constant in the workspace module — is a smaller diff but creates a second, invisible source of plan truth.

### 2. Repository — `packages/domain/src/workspace/repository.ts`

Add a lock that mirrors the existing `lockOrganization` (read its comment first: `packages/domain/src/workspace/repository.ts:29-53`; the `FOR NO KEY UPDATE` choice and the "lock before the first child insert" ordering apply here too):

```ts
/**
 * Serializes the per-user workspace count-and-create pair. `FOR NO KEY
 * UPDATE`: the `member.userId` foreign key takes a key-share on this row
 * while a workspace is being created, and a stronger lock would block
 * unrelated member inserts that merely reference the user.
 */
lockUser: (userId: string) =>
  db.execute(
    sql`SELECT id FROM ${schema.userTable} WHERE id = ${userId} FOR NO KEY UPDATE`
  ),

findOwnedOrganizationIds: (userId: string) =>
  Effect.gen(function* () {
    const memberships = yield* db
      .select({
        organizationId: schema.memberTable.organizationId,
        role: schema.memberTable.role,
      })
      .from(schema.memberTable)
      .where(eq(schema.memberTable.userId, userId));

    return memberships
      .filter(({ role }) => role.split(",").includes("owner"))
      .map(({ organizationId }) => organizationId);
  }),
```

`member` has an index on `userId` (`member_userId_idx`, `packages/db/src/schema/auth.ts:195`), so the lookup is indexed. Reuse `findPlanByOrganizationId` per owned id rather than joining subscriptions in a bespoke count query — the number of owned workspaces is at most the cap plus a few, and reusing the resolver guarantees the cap agrees with every other plan decision (including `past_due` handling).

### 3. New policy — `packages/domain/src/workspace/policies.ts`

The workspace module has no `policies.ts` today; this follows `packages/domain/src/board/policies.ts` and `changelog-category/policies.ts`.

```ts
import { PLAN_ENTITLEMENTS } from "../plan-entitlements";
import * as Policy from "../policy";
import { WorkspaceRepository } from "./repository";

const makeWorkspacePolicy = Effect.gen(function* () {
  const repository = yield* WorkspaceRepository;

  const canCreateWorkspace = ({ userId }: { userId: string }) =>
    Effect.gen(function* () {
      const organizationIds =
        yield* repository.findOwnedOrganizationIds(userId);

      const plans = yield* Effect.forEach(organizationIds, (organizationId) =>
        repository.findPlanByOrganizationId({ organizationId })
      );

      const limit = PLAN_ENTITLEMENTS.free.limits.workspaces;
      const freeOwned = plans.filter(({ plan }) => plan === "free").length;

      if (limit !== null && freeOwned >= limit) {
        return yield* new Policy.PolicyDeniedError({
          reason: `Free workspaces are limited to ${limit} per owner. Upgrade a workspace to create more.`,
        });
      }
    });

  return { canCreateWorkspace };
});

export class WorkspacePolicy extends Context.Service<WorkspacePolicy>()(
  "WorkspacePolicy",
  { make: makeWorkspacePolicy }
) {
  static readonly layer = Layer.effect(this, this.make);
}
```

If Option B is chosen instead, the body becomes "count all owned; if `>= limit` and none of the plans is paid, deny" — the plumbing is identical.

### 4. Handler — `packages/domain/src/workspace/handlers.ts`

Resolve the policy and check it **inside the existing transaction**, immediately after the lock and before the subdomain check / insert:

```ts
const workspacePolicy = yield * WorkspacePolicy;
// ...
const organizationId =
  yield *
  transaction(
    Effect.gen(function* () {
      yield* repository.lockUser(session.session.userId);
      yield* workspacePolicy.canCreateWorkspace({
        userId: session.session.userId,
      });

      const isSubdomainTaken = yield* repository.isSubdomainTaken(subdomain);
      // ...
    })
  );
```

`PolicyDeniedError` is already a member of `WorkspaceServiceErrors` (`packages/domain/src/workspace/errors.ts`), so no RPC-contract change is needed and the error reaches the client as a `PolicyDenied` tag (`packages/domain/src/policy.ts:24-31`, `403`).

### 5. Layer wiring

- `WorkspaceRpcHandlers` (`packages/domain/src/workspace/handlers.ts:106`) gains `Layer.provide(WorkspacePolicy.layer)` alongside `WorkspaceRepository.layer` and `SubdomainValidationService.layerEnv`.
- `rpc-router.ts` already provides `WorkspaceRpcHandlers` (`packages/domain/src/rpc-router.ts:103`); nothing to add there.
- The handler test layer (`packages/domain/src/workspace/handlers.test.ts:98-127`) calls `WorkspaceRpcHandlersEffect` directly and must now provide the policy:
  ```ts
  const WorkspacePolicyTest = WorkspacePolicy.layer.pipe(
    Layer.provide(RepositoryTest)
  );
  const TestLayer = Layer.mergeAll(
    RepositoryTest,
    Database.PgliteDatabaseLive,
    MockSubdomainValidationLayer,
    WorkspacePolicyTest
  );
  ```

### 6. Client — `apps/web/src/routes/_dashboard/register.tsx`

Today the catch discards the reason:

```ts
} catch {
  toastManager.add({ title: "Failed to create workspace", type: "error" });
}
```

`PolicyDenied` is in `ALLOWED_USER_FACING_TAGS`, and `parseRpcError` prefers `reason` (`packages/web-shared/src/lib/rpc-error.ts`), so the fix is one import and one line:

```ts
} catch (error) {
  trackEvent("org_created", { success: false });
  toastManager.add({
    title: parseRpcError(error, "Failed to create workspace").message,
    type: "error",
  });
}
```

(`parseRpcError` from `@feeblo/web-shared/lib/rpc-error`; pattern precedent: `post-merge-menu.tsx:193`.)

Optional UX follow-up: the workspace switcher (`workspace-switcher.tsx:81`) could hide/disable "Create workspace" at the cap. That needs a count the client does not have today (`WorkspaceRpcs` exposes no list of owned workspaces) — not worth a new RPC unless product asks; the server-side denial plus the toast is the enforcement that matters.

### 7. Pricing copy and tests that will fail without edits

- `packages/domain/src/pricing/features.ts` — hand-authored rows; add e.g. `{ key: "workspaces", label: "3 Workspaces" }` to `free` and `{ key: "workspaces", label: "Unlimited Workspaces" }` to `starter`/`professional`.
- `packages/domain/src/plan-entitlements.test.ts` — asserts the exact `PLAN_ENTITLEMENTS.starter` object and the exact `getPlanFeatureRows("starter")` array; both must gain the key. The free-rows test may gain an assertion too.
- No `apps/web` pricing component reads these rows directly; `PricingRpcs` serves them (`packages/domain/src/pricing/handlers.ts:137`).

---

## Concurrency: the count is only true under the lock

`createWorkspace` opens its own Drizzle transaction, and the outer `transaction(...)` in the handler nests via savepoint (`packages/db/src/database.ts`, `transaction` + fiber-local `currentDb`), so a plain count before the insert is a TOCTOU race: two `WorkspaceCreate` calls for the same user at 2 owned workspaces both read 2 and both insert, yielding 4. The existing per-workspace limits solve this by locking the organization row first (see the `lockOrganization` comment and `CompanyCreate`'s "First lock, first" ordering, `packages/domain/src/company/handlers.ts:40-51`; `docs/public-api.md:840` documents the same guarantee for the Public API). This limit spans workspaces, so the lockable row is the user: `lockUser` inside the transaction, then count, then insert. The second transaction waits on the lock, counts after the first commits, and denies correctly.

Caveat: PGlite is single-connection, so a unit test cannot exercise two concurrent transactions; the lock is a Postgres guarantee and the test suite has no precedent for racing these counts. Mirror the existing limit tests' style (below) and leave the race to the lock's comment.

---

## Tests to add — `packages/domain/src/workspace/handlers.test.ts`

The table sits in the existing `WorkspaceCreate` describe (`:128`), which uses `makeFixture` + `makeSession(fixture, role)` and `Effect.flip` + `expect(error._tag).toBe("PolicyDenied")`. Seed extra owned workspaces by inserting `organizationTable` + `memberTable` rows (`makeFixture` is the template), and seed a paid workspace with `productTable` + `subscriptionTable` rows as `changelog-subscription/handlers.test.ts:86-110` does.

1. An owner of 2 free workspaces can create a third.
2. An owner of 3 free workspaces is denied (`_tag` `PolicyDenied`, reason mentions the limit).
3. A user who is only a `manager`/`admin` member of 3 workspaces (not owner) can create one.
4. (Option A) An owner of 3 free + 1 paid is still denied; an owner of 2 free + 1 paid can create (the paid workspace is not counted).
5. (Option B) An owner of 3 any-plan workspaces including a paid one can create.

---

## Sign-off and housekeeping

- **Owner sign-off required** before writing: plan limits are in `AGENTS.md`'s "Money and limits" list (`plan-entitlements.ts` is named, and this changes what the free plan grants).
- **ADR**: the decision (A vs B, and why) should be recorded — next free number is `0013` (`docs/adr/` currently ends at `0012`). The existing references for this kind of decision are `0005` (limit ratchet) and `0011-deleting-an-account-erases-the-workspaces-it-alone-holds.md` (ownership semantics).
- **No docs change needed**: workspace creation is dashboard RPC only; `docs/public-api.md` and the SDK surfaces do not expose it.
- **Gate**: `pnpm check` after the change; the new tests run under `pnpm test` (the `@feeblo/e2e` excluded suite). An e2e case in `e2e/tests/auth.spec.ts` is optional — creating 4 workspaces through the UI is slow and the unit tests cover the decision.

---

## Sources

| Ref | What it establishes |
| --- | --- |
| `packages/domain/src/workspace/handlers.ts` | The only creation handler; transaction shape; error remapping |
| `packages/domain/src/workspace/repository.ts` | `createWorkspace` inserts; `findPlanByOrganizationId` plan resolution; `lockOrganization` lock discipline and rationale |
| `packages/domain/src/workspace/rpcs.ts`, `errors.ts` | RPC contract already includes `PolicyDeniedError`; no schema change needed |
| `packages/domain/src/plan-entitlements.ts` | `LimitFeatureKey`/`PLAN_FEATURE_CATALOG`/`PLAN_ENTITLEMENTS` and their compile-time completeness guards |
| `packages/domain/src/entitlement/policies.ts` | Count-based limit pattern (`canCreateCrmEntry`, `canCreateChangelogCategory`, `canAssignPrivilegedRole`) |
| `packages/domain/src/company/handlers.ts` (`CompanyCreate`) | Lock-first-then-count precedent and its comment |
| `packages/domain/src/policy.ts`, `packages/domain/src/rpc-errors.ts` | `PolicyDeniedError` shape, `403`, reason plumbing |
| `packages/web-shared/src/lib/rpc-error.ts` | `PolicyDenied` is user-facing; `parseRpcError` prefers `reason` |
| `apps/web/src/routes/_dashboard/register.tsx` | The create call and the catch-all error toast |
| `apps/web/src/dashboard/components/common/workspace-switcher.tsx` | Second entry point to `/register` |
| `apps/web/src/dashboard/lib/auth-redirects.ts` | `/register` is reachable by signed-in users with workspaces |
| `packages/auth/src/server.ts` | `allowUserToCreateOrganization: false`; owner-role `split(",")` semantics; `testUtils` gated to tests |
| `packages/db/src/schema/auth.ts` | `member` indexes, `role` typing, `user` table name, `subscription` shapes |
| `packages/db/src/database.ts` | Nested transactions become savepoints; `currentDb` joins the ambient transaction |
| `node_modules/better-auth/dist/plugins/organization/types.d.mts`, `.../routes/crud-org.mjs` | `organizationLimit` exists but is membership-scoped and route-bound |
| `packages/domain/src/plan-entitlements.test.ts`, `packages/domain/src/pricing/features.ts` | Tests and copy that must change with the catalog |
| `docs/public-api.md:840` | The repo's stated guarantee that count-and-write limits are locked inside the writing transaction |
