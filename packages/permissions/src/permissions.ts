/**
 * Named permissions — the vocabulary both backend enforcement and frontend
 * UI gating share. Every gate in the app should eventually be expressed as one
 * of these identifiers, never as an ad-hoc role comparison.
 *
 * Naming convention: `{entity}.{action}` where the action is one of:
 *   - `create`  — create records
 *   - `update`  — edit records
 *   - `manage`  — edit AND delete records (and destructive/attribute ops)
 *   - `moderate`— privileged actions on content owned by anyone
 *   - `view`    — read records
 *
 * The catalog is the source of truth for what each permission means. Keep it
 * in sync with `ROLE_PERMISSIONS` and the backend `*Policy` services.
 */
export const PERMISSIONS = [
  // Workspace & membership
  "workspace.manage",
  "workspace.delete",
  "members.view",
  "members.invite",
  "members.remove",
  "members.roles.assign",
  "members.roles.owner",

  // Billing & site
  "billing.manage",
  "site.manage",
  "site.customize",

  // Boards
  "boards.create",
  "boards.manage",

  // Posts
  "posts.create",
  "posts.vote",
  "posts.comment",
  "posts.manage",
  "posts.moderate",

  // Changelog
  "changelog.create",
  "changelog.manage",

  // Roadmap
  "roadmap.manage",

  // Tags
  "tags.create",
  "tags.manage",

  // CRM
  "contacts.create",
  "contacts.update",
  "contacts.manage",
  "contacts.attributes.manage",
  "companies.create",
  "companies.update",
  "companies.manage",
  "companies.attributes.manage",

  // Notifications
  "notifications.manage",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export type PermissionDefinition = {
  /** Short human label, used in docs and future settings UI. */
  readonly label: string;
  /** What the permission actually allows, anchored to backend policies. */
  readonly description: string;
  /**
   * True when the permission also requires a resource-level check (e.g. "is
   * the actor the creator of this record?"). Such checks can only run on the
   * backend; the frontend mirrors them with optimistic data when available.
   */
  readonly resourceScoped?: boolean;
};

export const PERMISSION_CATALOG: Record<Permission, PermissionDefinition> = {
  "workspace.manage": {
    label: "Manage workspace",
    description:
      "The umbrella owner/admin gate: workspace settings, members, billing, site, roadmap, and content moderation. Replaces the old hasOrganizationOwnerOrAdmin check.",
  },
  "workspace.delete": {
    label: "Delete workspace",
    description: "Permanently delete the workspace. Owner only.",
  },
  "members.view": {
    label: "View members",
    description: "List organization members and invitations.",
  },
  "members.invite": {
    label: "Invite members",
    description:
      "Invite new members and cancel pending invitations. Owners cannot be invited (see INVITABLE_ROLES).",
  },
  "members.remove": {
    label: "Remove members",
    description:
      "Remove members from the workspace. Rank rules apply: an actor may only remove targets ranked below them, and the last owner cannot be removed.",
  },
  "members.roles.assign": {
    label: "Assign roles",
    description:
      "Change a member's role. Rank rules apply: an actor may assign only roles at or below their own rank, and never to a higher-ranked target.",
  },
  "members.roles.owner": {
    label: "Assign owner role",
    description: "Grant or transfer the owner role. Owner only.",
  },
  "billing.manage": {
    label: "Manage billing",
    description: "Manage plans, invoices, and payment methods.",
  },
  "site.manage": {
    label: "Manage public site",
    description:
      "Manage the public feature board site (subdomain, visibility).",
  },
  "site.customize": {
    label: "Customize public site",
    description: "Edit site name, branding, and SEO settings.",
  },
  "boards.create": {
    label: "Create boards",
    description: "Create new feedback boards.",
  },
  "boards.manage": {
    label: "Manage boards",
    description:
      "Rename or delete any board. The board creator also passes (resource check).",
    resourceScoped: true,
  },
  "posts.create": {
    label: "Create posts",
    description: "Submit feedback posts from the dashboard.",
  },
  "posts.vote": {
    label: "Vote on posts",
    description: "Upvote/downvote posts.",
  },
  "posts.comment": {
    label: "Comment on posts",
    description: "Comment on posts, including internal comments.",
  },
  "posts.manage": {
    label: "Manage posts",
    description:
      "Edit or delete any post. The post author also passes (resource check).",
    resourceScoped: true,
  },
  "posts.moderate": {
    label: "Moderate posts",
    description:
      "Privileged post actions: lock/unlock, archive, change status, merge. Owner/admin only — authors do not pass.",
  },
  "changelog.create": {
    label: "Create changelog entries",
    description: "Create changelog entries.",
  },
  "changelog.manage": {
    label: "Manage changelog entries",
    description:
      "Edit or delete any changelog entry. The entry creator also passes (resource check).",
    resourceScoped: true,
  },
  "roadmap.manage": {
    label: "Manage roadmap",
    description: "Create, update, and delete roadmap columns and roadmaps.",
  },
  "tags.create": {
    label: "Create tags",
    description: "Create post tags.",
  },
  "tags.manage": {
    label: "Manage tags",
    description:
      "Edit or delete any tag. The tag creator also passes (resource check).",
    resourceScoped: true,
  },
  "contacts.create": {
    label: "Create contacts",
    description: "Create CRM contacts.",
  },
  "contacts.update": {
    label: "Update contacts",
    description: "Edit CRM contacts.",
  },
  "contacts.manage": {
    label: "Manage contacts",
    description:
      "Delete contacts and manage contact attribute definitions. Owner/admin only.",
  },
  "contacts.attributes.manage": {
    label: "Manage contact attributes",
    description: "Create, update, and delete contact attribute definitions.",
  },
  "companies.create": {
    label: "Create companies",
    description: "Create CRM companies.",
  },
  "companies.update": {
    label: "Update companies",
    description: "Edit CRM companies.",
  },
  "companies.manage": {
    label: "Manage companies",
    description:
      "Delete companies and manage company attribute definitions. Owner/admin only.",
  },
  "companies.attributes.manage": {
    label: "Manage company attributes",
    description: "Create, update, and delete company attribute definitions.",
  },
  "notifications.manage": {
    label: "Manage notifications",
    description: "Read and mark own notifications as read.",
  },
};
