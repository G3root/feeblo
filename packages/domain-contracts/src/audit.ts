import * as Schema from "effect/Schema";

/**
 * Audit vocabulary shared by the writer (server) and the reader (dashboard).
 *
 * It lives in this package rather than beside the endpoints it guards because
 * the dashboard labels and filters entries, and `@feeblo/domain` is not
 * importable from client packages (see `docs/adr/0002`). Nothing here touches
 * storage: `@feeblo/db/schema/audit` derives its column types from these, and
 * the recorder derives the row from the action, so the three cannot drift.
 */

/**
 * Who performed an audited action.
 *
 * `user` is a dashboard session; `api_key` and `oauth_client` are the two
 * machine credentials the Public API accepts (`PublicApiCredential` in
 * `public-api/api-key-auth.ts`); `system` is the product acting on its own —
 * a scheduled sweep, a delivery retry, a webhook fan-out.
 */
export const AuditActorType = Schema.Literals([
  "user",
  "api_key",
  "oauth_client",
  "system",
]);

export type TAuditActorType = Schema.Schema.Type<typeof AuditActorType>;

/** The surface the request arrived through, which is not the same as who acted. */
export const AuditLogSource = Schema.Literals([
  "dashboard",
  "public_api",
  "system",
]);

export type TAuditLogSource = Schema.Schema.Type<typeof AuditLogSource>;

/** Whether the action happened or was refused. A denial is an entry, not a log line. */
export const AuditOutcome = Schema.Literals(["allowed", "denied"]);

export type TAuditOutcome = Schema.Schema.Type<typeof AuditOutcome>;

/**
 * The before/after diff of an update, plus the field names on their own so the
 * `changed` filter is a membership test rather than a JSON scan.
 *
 * `fields` is authoritative. `after` omits a field the action cleared rather
 * than spelling it `undefined`, and a value that is not in either map was not
 * captured — absence is not evidence of "no change".
 */
export const AuditChanges = Schema.Struct({
  fields: Schema.Array(Schema.String),
  before: Schema.Record(Schema.String, Schema.Unknown),
  after: Schema.Record(Schema.String, Schema.Unknown),
});

export type TAuditChanges = Schema.Schema.Type<typeof AuditChanges>;

/**
 * Action-specific context, a JSON object rather than a diff: the endpoint and
 * status of an audited read, the subject of a member action, a refused route.
 * Each action documents the keys it writes; the reader treats them as opaque.
 */
export const AuditMetadata = Schema.Record(Schema.String, Schema.Unknown);

export type TAuditMetadata = Schema.Schema.Type<typeof AuditMetadata>;

interface AuditResourceDefinition {
  readonly singleton?: true;
  readonly verbs: ReadonlyArray<string>;
}

/**
 * Every audited action, grouped by the resource it acts on.
 *
 * The key is both the stored `resource_type` and the `<resource>` half of the
 * `<resource>.<verb>` action string, so the two are derived from one another
 * and cannot disagree. `singleton: true` marks a resource a workspace has at
 * most one of (its settings, a bulk transfer): those actions take no
 * `resourceId`, and passing one is a type error in the recorder.
 *
 * Adding a verb here is what makes a call site compile, and `AuditActionLabels`
 * below must cover every pair, so a new verb cannot ship without a name.
 *
 * Keep this append-only: a removed verb leaves stored rows outside every filter
 * the reader knows how to build.
 */
export const AuditResources = {
  workspace: { singleton: true, verbs: ["updated", "deleted"] },
  member: { verbs: ["invited", "joined", "role_changed", "removed"] },
  board: { verbs: ["created", "updated", "deleted", "imported", "exported"] },
  post: {
    verbs: [
      "created",
      "updated",
      "deleted",
      "status_changed",
      "moved",
      "locked",
      "archived",
      "merged",
      "unmerged",
    ],
  },
  comment: { verbs: ["created", "updated", "deleted", "pinned"] },
  vote: { verbs: ["added", "removed", "on_behalf_added"] },
  changelog: { verbs: ["created", "updated", "published", "deleted"] },
  changelog_category: { verbs: ["created", "updated", "deleted"] },
  roadmap: { verbs: ["created", "updated", "deleted"] },
  post_status: { verbs: ["created", "updated", "deleted"] },
  tag: { verbs: ["created", "updated", "deleted", "assigned", "unassigned"] },
  contact: { verbs: ["created", "updated", "deleted", "read"] },
  company: { verbs: ["created", "updated", "deleted"] },
  webhook: { verbs: ["created", "updated", "deleted"] },
  integration: { verbs: ["connected", "updated", "disconnected"] },
  api_key: { verbs: ["created", "revoked"] },
  email_suppression: { verbs: ["added", "removed"] },
  user_ban: { verbs: ["created", "removed"] },
  data_transfer: { singleton: true, verbs: ["imported", "exported"] },
  /** Requests refused at the credential boundary; the route rides in `metadata`. */
  api: { singleton: true, verbs: ["request"] },
} as const satisfies Record<string, AuditResourceDefinition>;

export type TAuditResourceType = keyof typeof AuditResources;

/** `<resource>.<verb>` for every declared pair: the closed set of audit actions. */
export type TAuditAction = {
  [
    K in TAuditResourceType
  ]: `${K}.${(typeof AuditResources)[K]["verbs"][number]}`;
}[TAuditResourceType];

/** The resource half of an action, at the type level. */
export type TAuditResourceOf<A extends TAuditAction> =
  A extends `${infer R}.${string}`
    ? R extends TAuditResourceType
      ? R
      : never
    : never;

/**
 * The action half of every declared pair, and the schema a filter validates
 * against. The catalog is append-only, so an action this build does not know
 * is a client mistake rather than a row from the future.
 */
export const AUDIT_ACTIONS: ReadonlyArray<TAuditAction> = Object.entries(
  AuditResources
).flatMap(([resource, { verbs }]) =>
  verbs.map(
    // SAFETY: `resource` is a key of the catalog and `verb` one of the verbs
    // that resource declares, so the template is a declared pair by construction.
    (verb) => `${resource}.${verb}` as TAuditAction
  )
);

export const AuditActionSchema = Schema.Literals(AUDIT_ACTIONS);

export const AUDIT_RESOURCE_TYPES: ReadonlyArray<TAuditResourceType> =
  // SAFETY: every key of the catalog is a resource type by definition.
  Object.keys(AuditResources) as ReadonlyArray<TAuditResourceType>;

export const AuditResourceTypeSchema = Schema.Literals(AUDIT_RESOURCE_TYPES);

/**
 * The resource half of an action string. The stored `resource_type` is always
 * this, never a second argument a caller could get wrong.
 *
 * The overload narrows a declared action to its declared resource without a
 * cast: the split of `<resource>.<verb>` is that resource by construction.
 */
export function auditResourceTypeOf<A extends TAuditAction>(
  action: A
): TAuditResourceOf<A>;
export function auditResourceTypeOf(action: string): string;
export function auditResourceTypeOf(action: string): string {
  const separator = action.indexOf(".");

  return separator === -1 ? action : action.slice(0, separator);
}

/**
 * Actions that record access rather than a change.
 *
 * A list of literals, not a `*.read` suffix rule: `board.exported` moves a
 * whole board's worth of customer data and no suffix captures it. The reader
 * leaves these out of its default view unless they were denied, and the web
 * client mutes them in a mixed list.
 */
export const AUDIT_ACCESS_ACTIONS = [
  "board.exported",
  "data_transfer.exported",
  "contact.read",
] as const satisfies ReadonlyArray<TAuditAction>;

const accessActions: ReadonlyArray<string> = AUDIT_ACCESS_ACTIONS;

/** True for an access action (see {@link AUDIT_ACCESS_ACTIONS}). */
export const isAuditAccessAction = (action: string): boolean =>
  accessActions.includes(action);

/**
 * Sentence-case labels, keyed by action and by resource.
 *
 * The `satisfies` is the point: a declared action with no label, or a label for
 * an action that no longer exists, fails the build.
 */
export const AuditActionLabels = {
  "workspace.updated": "Updated workspace settings",
  "workspace.deleted": "Deleted workspace",
  "member.invited": "Invited member",
  "member.joined": "Member joined",
  "member.role_changed": "Changed member role",
  "member.removed": "Removed member",
  "board.created": "Created board",
  "board.updated": "Updated board",
  "board.deleted": "Deleted board",
  "board.imported": "Imported board",
  "board.exported": "Exported board",
  "post.created": "Created post",
  "post.updated": "Updated post",
  "post.deleted": "Deleted post",
  "post.status_changed": "Changed post status",
  "post.moved": "Moved post",
  "post.locked": "Locked post",
  "post.archived": "Archived post",
  "post.merged": "Merged post",
  "post.unmerged": "Unmerged post",
  "comment.created": "Created comment",
  "comment.updated": "Updated comment",
  "comment.deleted": "Deleted comment",
  "comment.pinned": "Pinned comment",
  "vote.added": "Added vote",
  "vote.removed": "Removed vote",
  "vote.on_behalf_added": "Added vote on behalf of a customer",
  "changelog.created": "Created changelog entry",
  "changelog.updated": "Updated changelog entry",
  "changelog.published": "Published changelog entry",
  "changelog.deleted": "Deleted changelog entry",
  "changelog_category.created": "Created changelog category",
  "changelog_category.updated": "Updated changelog category",
  "changelog_category.deleted": "Deleted changelog category",
  "roadmap.created": "Created roadmap",
  "roadmap.updated": "Updated roadmap",
  "roadmap.deleted": "Deleted roadmap",
  "post_status.created": "Created status",
  "post_status.updated": "Updated status",
  "post_status.deleted": "Deleted status",
  "tag.created": "Created tag",
  "tag.updated": "Updated tag",
  "tag.deleted": "Deleted tag",
  "tag.assigned": "Assigned tag",
  "tag.unassigned": "Unassigned tag",
  "contact.created": "Created contact",
  "contact.updated": "Updated contact",
  "contact.deleted": "Deleted contact",
  "contact.read": "Viewed contact",
  "company.created": "Created company",
  "company.updated": "Updated company",
  "company.deleted": "Deleted company",
  "webhook.created": "Created webhook",
  "webhook.updated": "Updated webhook",
  "webhook.deleted": "Deleted webhook",
  "integration.connected": "Connected integration",
  "integration.updated": "Updated integration",
  "integration.disconnected": "Disconnected integration",
  "api_key.created": "Created API key",
  "api_key.revoked": "Revoked API key",
  "email_suppression.added": "Blocked email address",
  "email_suppression.removed": "Unblocked email address",
  "user_ban.created": "Banned user",
  "user_ban.removed": "Unbanned user",
  "data_transfer.imported": "Imported data",
  "data_transfer.exported": "Exported data",
  "api.request": "Made API request",
} as const satisfies Record<TAuditAction, string>;

/** What each resource is called in the UI. The catalog above deliberately has no label. */
export const AuditResourceLabels = {
  workspace: "Workspace",
  member: "Member",
  board: "Board",
  post: "Post",
  comment: "Comment",
  vote: "Vote",
  changelog: "Changelog entry",
  changelog_category: "Changelog category",
  roadmap: "Roadmap",
  post_status: "Status",
  tag: "Tag",
  contact: "Contact",
  company: "Company",
  webhook: "Webhook",
  integration: "Integration",
  api_key: "API key",
  email_suppression: "Email suppression",
  user_ban: "User ban",
  data_transfer: "Data transfer",
  api: "API",
} as const satisfies Record<TAuditResourceType, string>;

const actionLabels: ReadonlyMap<string, string> = new Map(
  Object.entries(AuditActionLabels)
);

const resourceLabels: ReadonlyMap<string, string> = new Map(
  Object.entries(AuditResourceLabels)
);

/** Label for an action string read off a row; null for one this build does not know. */
export const auditActionLabel = (action: string): string | null =>
  actionLabels.get(action) ?? null;

/** Label for a `resource_type` read off a row, or null for an unknown one. */
export const auditResourceLabel = (type: string): string | null =>
  resourceLabels.get(type) ?? null;
