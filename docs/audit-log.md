# Audit log

An append-only record of what a workspace's **operators** did — members and machine credentials — and of the requests refused at the credential boundary.

It is not a product activity feed. Votes, comments and portal reads live in `post_activity`, which is about one post's timeline; this is about authority: which credential changed what, under which role, from which request. The two differ in reader, retention and write moment, and the split is what keeps the audit log worth reading.

**Status: behind a feature flag.** `FEATURE_FLAGS.AUDIT_LOG` is `false`. The table, the recorder and the read RPC ship ahead of the switch; with the flag off the recorder writes nothing, so turning it on starts the history at that moment. That is deliberate: a half-wired writer must not fill a table the product cannot yet show, and an audit history has no honest backfill.

## Layout

| Path | Role |
| --- | --- |
| `packages/domain-contracts/src/audit.ts` | Vocabulary and the action catalog, shared by writer and reader |
| `packages/db/src/schema/audit.ts` | `audit_log` table, indexes, check constraints |
| `packages/domain/src/audit-log/flag.ts` | `AuditLogEnabled`, the `Context.Reference` the recorder reads |
| `packages/domain/src/audit-log/recorder.ts` | `record` / `recordBestEffort`, redaction, row construction |
| `packages/domain/src/audit-log/attribution.ts` | `actorFromSession`, `actorFromSystem` |
| `packages/domain/src/audit-log/repository.ts` | Insert, keyset page query |
| `packages/domain/src/audit-log/rpcs.ts` | `ListAuditLogEntries` |
| `packages/domain/src/audit-log/handlers.ts` | The role gate and the label projection |

## The row

`audit_log` (`packages/db/src/schema/audit.ts`):

```
id, organization_id,
occurred_at, recorded_at,
actor_type, actor_user_id, actor_token_id, actor_label, actor_role, affected_user_id,
source, action, outcome, denial_reason,
resource_type, resource_id,
changes jsonb, metadata jsonb,
request_id, origin_ip, origin_country, user_agent
```

- **`occurred_at` vs `recorded_at`.** When the action happened, and when the row was written. In a transaction they are the same instant; they diverge only if a writer ever batches, and the reader wants `occurred_at` either way.
- **`changes` vs `metadata`.** `changes` is the strict before/after diff (`{ fields, before, after }`). `metadata` is the action-specific context — the endpoint and status of an audited read, the member-management subject's name, a route. Anything that is not a field-by-field diff belongs in `metadata`.
- **`actor_label` is frozen; a person's name is not.** An API key's name at the time of the action is the audit fact, and the key is usually revoked next. A member's name is resolved from the directory when the log is read, so a rename corrects it and a departed member shows their id. Do not name an API-key row from the user table: every key row also carries `actor_user_id` (whoever minted it), and that would put a person's name on an action the key took.
- **No foreign keys on the actor.** A deleted user or a revoked key must leave the entry intact. `organization_id` cascades, so deleting a workspace deletes its log — the log is a workspace-internal accountability record, not a legal archive.

## Invariants the database keeps

```sql
check (resource_type = split_part(action, '.', 1))          -- derived, never restated
check ((outcome = 'allowed' and denial_reason is null)
    or (outcome = 'denied'  and denial_reason is not null))
check (actor_type = 'system' or actor_user_id is not null or actor_token_id is not null)
check (actor_role is null or actor_type in ('user', 'oauth_client'))
```

A `BEFORE UPDATE OR DELETE` trigger raises unless the transaction set `feeblo.audit_retention = 'on'`, so append-only is a promise the database keeps rather than a convention the writer remembers. The retention sweep is the one writer allowed to opt in.

Indexes: `(organization_id, occurred_at DESC, id DESC)` for the listing and its keyset predicate, one per filtered column pair (`action`, `resource_type`, `actor_user_id`), a GIN index on `changes -> 'fields'`, a partial index for denials, and `occurred_at` alone for the retention sweep. `TRUNCATE` bypasses row triggers, so `nukeDatabase` still works and is not a hole.

## The catalog is the type system

`packages/domain-contracts/src/audit.ts` declares every action as `<resource>.<verb>`:

```ts
export const AuditResources = {
  post: { verbs: ["created", "updated", "deleted", "status_changed", "moved", "locked", …] },
  workspace: { singleton: true, verbs: ["updated", "deleted"] },
  …
} as const satisfies Record<string, AuditResourceDefinition>;
```

`TAuditAction` is a template-literal union over it, so a typo or an undeclared verb fails the build; `AuditActionLabels` is a `satisfies Record<TAuditAction, string>`, so a new verb cannot ship without a name; `AUDIT_ACTIONS` and `AuditActionSchema` are derived for the read filters, which is what lets an unknown action be a `400` rather than a silently empty page.

Two rules:

- **`resource_type` is derived from the action**, in the recorder and in the check constraint. Nothing restates it.
- **The catalog is append-only.** A removed verb orphans stored rows outside every filter the reader knows how to build. Row labels degrade to `null` in the reader, which is the only tolerance the design allows.

`AUDIT_ACCESS_ACTIONS` marks the actions that record access rather than change. It is a list of literals, not a `*.read` suffix rule — `board.exported` moves a whole board's worth of customer data and no suffix captures it.

## Writing

Two modes, and the difference matters:

**Inside the mutation's transaction** — the default:

```ts
yield* transaction(
  Effect.gen(function* () {
    yield* repository.setPostTags({ … });
    yield* audit.record({
      organizationId,
      actor: actorFromSession(session, organizationId),
      source: "dashboard",
      action: "post.updated",
      resourceId: postId,
      changes: { fields: ["tagIds"], before: { tagIds: previous }, after: { tagIds } },
    });
  })
);
```

`record` fails if it cannot write, and that is the point: a failed `INSERT` aborts the Postgres transaction, so catching it would not undo the abort — it would only hide the cause and leave a transaction that cannot commit. No `catchAll` here.

**Outside a transaction** — `recordBestEffort`, for a write that is already durable: it logs and gives up. The action happened; a missing row is a gap to alert on, not a reason to fail the caller twice.

The recorder derives `resource_type`, stamps `occurred_at` from `DateTime`, and redacts credential-shaped keys in `changes` and `metadata` (`secret`, `token`, `password`, `api_key`, `private_key`, `credential`, `hash`, `salt`) as a backstop. The call site still owes the truth: never put a credential in a diff.

Attribution comes from one function per surface, never from a call site's guess:

- `actorFromSession(session, organizationId)` — a dashboard write. It freezes the role that admitted the write, so a later demotion cannot rewrite the entry.
- `actorFromSystem()` — a sweep, a retry, a fan-out.
- An API key or OAuth grant gets `type: "api_key" | "oauth_client"` with `tokenId` and the credential's name, plus the person behind it as `userId` when the credential has one.

## Reading

`ListAuditLogEntries` is session-authenticated and gated on `auditLog.read`, which `admin` and above hold. There is no write RPC and there should never be: an entry is a by-product of the action it records, written in that action's transaction. A surface that could append or amend entries is a surface that could rewrite the record.

Pages are keyset on `(occurred_at, id)`, one row past the limit to answer "has more" without a count. Keyset, not an offset: the table only grows at the top, so a page read after a new entry arrived continues in the same place, where an offset would shift and repeat.

`kind` splits the log: `changes` leaves out data access **unless it was denied** (a refused read is a change in the workspace's security posture), `access` returns only data access, absent returns both. `changed` matches membership in `changes.fields` through the GIN index.

The response carries `actionLabel` and `resourceLabel` from the build that answered, so a client built before a new verb still shows a label; an action the build does not know reads as `null` rather than failing the page.

## What to audit, and what not to

Record every mutation of a workspace-scoped resource by a member or a credential, every denial at the credential boundary (`api.request` with `outcome: "denied"` and the missing scope as its reason), and the bulk reads that move other people's data: `board.exported`, `data_transfer.exported`, `contact.read`.

Do not record end-user actions (the portal and widget are `post_activity`), delivery attempts, webhook fan-out, or dashboard permission misses — a contributor clicking a hidden control is not a security event, and every one would be a row.

The audited-read list is the sizing decision, not a detail: it is the difference between a table that needs no partitioning for years and one that does.

### Shipped call sites

`SetPostTags` (`packages/domain/src/tag/handlers.ts`) is the first in-transaction writer. Further call sites are additive: add the action to the catalog, call `record` inside the handler's transaction, and provide `AuditLogRecorder.layer` where the handler layer is built.

## Not built yet

- The dashboard page and its filters; the RPC has no client.
- The Public API surface (`audit_log.read` scope, hand-written DTO per ADR 0004).
- The retention sweep (`packages/db` script) and any plan-based retention.
- Denial recording: `api.request` is declared but nothing writes it.
- Partitioning. Revisit at roughly 20M live rows or when a retention sweep takes minutes; the primary key would have to include `occurred_at`, so the decision is a rewrite, made with numbers rather than a hunch.

## Tests

`packages/domain/src/audit-log/` — catalog integrity, repository paging and filters, the check constraints and the append-only trigger, the recorder's flag, derivation and redaction, and the handler's role gate.
