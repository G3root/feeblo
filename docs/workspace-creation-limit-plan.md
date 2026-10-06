# Implementation plan: cap a free owner at three free workspaces (Option A)

**Status:** proposed. Owner sign-off recorded in conversation; implement as its own commit. **Decision:** a user may own at most **3 workspaces whose plan resolves to `free`**. Paid workspaces are excluded from the count and do **not** raise the cap. Upgrading a free workspace frees a slot. **Record:** write `docs/adr/0013-a-free-owner-owns-at-most-three-free-workspaces.md` with this change. **Research:** `docs/workspace-creation-limit-research.md` (creation path, why not better-auth, concurrency rationale).

## Invariants

- Count = organizations where the user's `member.role` split on `,` includes `owner` **and** `findPlanByOrganizationId` returns `"free"`.
- Enforcement point = `WorkspaceRpcHandlersEffect.WorkspaceCreate`, inside the existing `transaction(...)`, after taking a `FOR NO KEY UPDATE` lock on the user row. A count outside the lock is a TOCTOU race.
- A user who is only a member of many workspaces is unrestricted; ownership is what counts.
- Non-goals: no Public API change, no change to better-auth's disabled `/organization/create`, no client-only gate, no change to how plans are resolved.

---

## Step 1 — Entitlement catalog

`packages/domain/src/plan-entitlements.ts`

1. Add `"workspaces"` to `LimitFeatureKey`.
2. Add a `PLAN_FEATURE_CATALOG` entry:
   ```ts
   workspaces: {
     kind: "limit",
     singularLabel: "Workspace",
     pluralLabel: "Workspaces",
   },
   ```
3. Append `"workspaces"` to `LIMIT_FEATURE_ORDER` (the `defineFeatureOrder` guard forces exactly one position).
4. Set `free.limits.workspaces = 3`, `starter.limits.workspaces = null`, `professional.limits.workspaces = null`.

`PlanLimits = Record<LimitFeatureKey, number | null>` and the `defineFeatureOrder` guard will surface every remaining edit as a type error. `getPlanFeatureRows("free")` now emits `{ key: "workspaces", label: "3 Workspaces" }`; paid plans emit `"Unlimited Workspaces"`.

## Step 2 — Pricing wire schema

`packages/domain/src/pricing/schema.ts`

Add the key to `PlanLimits` or the `satisfies { [K in LimitFeatureKey]: S.Schema<number | null> }` constraint fails:

```ts
const PlanLimits = S.Struct({
  // ...
  workspaces: S.NullOr(S.Finite),
} satisfies { readonly [K in LimitFeatureKey]: S.Schema<number | null> });
```

**Deploy note:** `/api/plans` is HTTP-cached for an hour. A client with a warm cache can receive a pre-deploy body missing `workspaces` and `Schema.decodeUnknownSync(PlansResponse)` in `apps/web/src/dashboard/hooks/use-plan-catalog.ts` will throw, showing the plan-picker error state for at most the remaining `max-age`. Acceptable for this app (server and web deploy together, in-process cache is cold on deploy), but if it must be seamless, give the field a decoding default **and verify the `satisfies` still holds** — do not drop the constraint silently.

## Step 3 — Repository primitives

`packages/domain/src/workspace/repository.ts`

Add inside `makeWorkspaceRepository`, near `lockOrganization`:

```ts
/**
 * Serializes the per-user workspace count-and-create pair. `FOR NO KEY
 * UPDATE`, for the same reason as `lockOrganization`: the `member.userId`
 * foreign key takes a key-share on this row while a workspace is created,
 * and a stronger lock would block unrelated member inserts that merely
 * reference the user. Take it before the transaction's first child insert.
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

`member_userId_idx` covers the lookup. The `split(",")` ownership test mirrors `packages/auth/src/server.ts:357-359`.

## Step 4 — New policy module

`packages/domain/src/workspace/policies.ts` (new; shape from `packages/domain/src/board/policies.ts`)

```ts
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { PLAN_ENTITLEMENTS } from "../plan-entitlements";
import * as Policy from "../policy";
import { WorkspaceRepository } from "./repository";

const makeWorkspacePolicy = Effect.gen(function* () {
  const repository = yield* WorkspaceRepository;

  const canCreateWorkspace = ({ userId }: { readonly userId: string }) =>
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

Reusing `findPlanByOrganizationId` per owned workspace keeps a single plan rule (active/trialing, `past_due` before period end, otherwise free). Owned counts are small; the N+1 is acceptable and preferable to a second, drift-prone SQL definition of "paid".

## Step 5 — Handler and layer

`packages/domain/src/workspace/handlers.ts`

1. Import and resolve: `const workspacePolicy = yield* WorkspacePolicy;`
2. Inside the existing transaction, **lock first, then check, then insert**:
   ```ts
   const organizationId = yield* transaction(
     Effect.gen(function* () {
       yield* repository.lockUser(session.session.userId);
       yield* workspacePolicy.canCreateWorkspace({
         userId: session.session.userId,
       });

       const isSubdomainTaken = yield* repository.isSubdomainTaken(subdomain);
       // ...unchanged
   ```
3. Bottom layer composition gains the policy:
   ```ts
   export const WorkspaceRpcHandlers = WorkspaceRpcs.toLayer(
     WorkspaceRpcHandlersEffect
   ).pipe(
     Layer.provide(WorkspaceRepository.layer),
     Layer.provide(WorkspacePolicy.layer),
     Layer.provide(SubdomainValidationService.layerEnv)
   );
   ```

No RPC-contract change: `PolicyDeniedError` is already in `WorkspaceServiceErrors` (`workspace/errors.ts`).

## Step 6 — Client surfaces the reason

`apps/web/src/routes/_dashboard/register.tsx`

The catch currently discards the failure. `PolicyDenied` is already in `ALLOWED_USER_FACING_TAGS` and `parseRpcError` prefers `reason` (`packages/web-shared/src/lib/rpc-error.ts`):

```ts
} catch (error) {
  trackEvent("org_created", { success: false });
  toastManager.add({
    title: parseRpcError(error, "Failed to create workspace").message,
    type: "error",
  });
  return;
}
```

Precedent: `apps/web/src/dashboard/features/post/components/post-merge-menu.tsx:193`. Leave the workspace switcher alone — it has no owned-count data, and adding an RPC for a hide-at-cap affordance is not worth it unless product asks.

## Step 7 — Pricing copy

`packages/domain/src/pricing/features.ts` (hand-authored; does not read the catalog):

- `free`: add `{ key: "workspaces", label: "3 Workspaces" }` after the `crmEntries` row.
- `starter`: add `{ key: "workspaces", label: "Unlimited Workspaces" }` in the same position.
- `professional`: no row. `PLAN_PRICING_FEATURES` lists only what a plan adds over the one below, and unlimited workspaces already appears on Starter.

`PlanFeatureRow.key` is `S.String`, so no wire-schema change here.

## Step 8 — Tests

### `packages/domain/src/plan-entitlements.test.ts`

Exact-value tests will fail until updated:

- `PLAN_ENTITLEMENTS.starter` object: add `workspaces: null`.
- `getPlanFeatureRows("starter")` array: add `{ key: "workspaces", label: "Unlimited Workspaces" }` after the `crmEntries` row.
- Optionally assert `getPlanFeatureRows("free")` contains `{ key: "workspaces", label: "3 Workspaces" }`.

### `packages/domain/src/workspace/handlers.test.ts`

The handler layer now requires the policy, so this file provides it (import plus `WorkspacePolicyTest` merged into `TestLayer`); its existing cases run as an owner of at most one workspace and pass. Add the import and layer entries:

```ts
import { WorkspacePolicy } from "./policies";

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

### `packages/domain/src/workspace/free-workspace-limit.test.ts` (new)

The five cases live in a new file with its own PGlite instance: the paid fixtures insert `product` rows, and sharing `handlers.test.ts`'s database would break its product-list assertions. The file seeds with a bare session (`organizations: []`) so no fixture workspace skews the count:

```ts
const createOwnedWorkspace = (
  userId: string,
  options: { paid?: boolean } = {}
) =>
  Effect.gen(function* () {
    const db = yield* currentDb;
    const organizationId = yield* WorkspaceId.generate;
    const now = yield* DateTime.nowAsDate;

    yield* db.insert(schema.organizationTable).values({
      id: organizationId,
      name: "Owned Workspace",
      slug: organizationId,
      createdAt: now,
    });
    yield* db.insert(schema.memberTable).values({
      id: `membership_${organizationId}`,
      organizationId,
      userId,
      role: "owner",
      createdAt: now,
    });

    if (options.paid) {
      // Copy the product + subscription seeding from
      // packages/domain/src/changelog-subscription/handlers.test.ts:86-110
      // (metadata: { plan: "starter", ... }, status: "active").
    }
    return organizationId;
  });
```

Cases (each `Effect.flip` + `expect(error._tag).toBe("PolicyDenied")` on denial):

| # | Setup (owned by the session user) | Expected |
| --- | --- | --- |
| 1 | 2 free | create succeeds, org row exists |
| 2 | 3 free | denied; reason names the limit |
| 3 | 3 workspaces where the user is `manager`/`admin`, not owner | create succeeds |
| 4 | 2 free + 1 paid | create succeeds (paid not counted) |
| 5 | 3 free + 1 paid | denied |

Do not add a concurrency test: PGlite is single-connection, and the repo has no precedent for racing these counts. The lock and its comment carry that guarantee.

## Step 9 — ADR and docs

- New `docs/adr/0013-a-free-owner-owns-at-most-three-free-workspaces.md`: decision, why A over B (Option B lets one subscription unlock unlimited free workspaces) and over C (blocks paying customers), and the consequences: paid workspaces are unbounded (pay-per-workspace is intended), a user can cycle upgrade→create and exceed 3 total while never exceeding 3 free, and the pricing payload gains a key.
- Optionally add a one-line "Decision: Option A" note at the top of the research doc's option section.

---

## Verification

```bash
# focused loop
pnpm --filter @feeblo/domain exec vitest run src/workspace/handlers.test.ts
pnpm --filter @feeblo/domain exec vitest run src/plan-entitlements.test.ts

# the gate
pnpm check
```

Manual smoke (dashboard): create 3 workspaces → the 4th shows the denied toast with the reason; upgrade one of the three (Billing) → the next create succeeds. Public API and SDKs are untouched.

## Risks / gotchas checklist

- [ ] Every consumer of `WorkspaceRpcHandlersEffect` in tests provides `WorkspacePolicy` (only `workspace/handlers.test.ts` today).
- [ ] `PlanLimits` in `pricing/schema.ts` updated, or `pnpm check` fails on the `satisfies`.
- [ ] `plan-entitlements.test.ts` exact-object and exact-array assertions updated.
- [ ] Count runs **inside** the transaction and after `lockUser`; never hoist it above `transaction(...)`.
- [ ] Pricing copy added to `PLAN_PRICING_FEATURES`; the catalog addition alone does not change the rendered table.
- [ ] Commit contains only this change; `pnpm check` was run; no `--no-verify`.

## Rollback

Revert the commit. No migration, no data written; workspaces created while the limit was live stay above any cap, and the check is `>=`, so they simply cannot create more.
