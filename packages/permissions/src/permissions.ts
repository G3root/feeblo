/**
 * Named permissions shared by backend enforcement and frontend UI gating.
 *
 * Every permission has exactly one dot: `{resource}.{action}`. Each resource
 * also gets a wildcard permission (`{resource}.*`) that grants every action
 * for that resource.
 */

type PermissionActions = readonly string[];

/** Create action permissions plus the resource wildcard. */
export const createPermissions = <
  const Resource extends string,
  const Actions extends PermissionActions,
>(
  resource: Resource,
  actions: Actions
): readonly `${Resource}.${Actions[number] | "*"}`[] =>
  [...actions, "*"].map(
    (action) =>
      // SAFETY: The runtime invariant checked by the surrounding code guarantees this type.
      `${resource}.${action}` as `${Resource}.${Actions[number] | "*"}`
  );

const PERMISSION_ACTIONS = {
  workspace: ["update", "delete"],
  members: ["invite", "remove", "assign"],
  billing: ["update"],
  site: ["update"],
  boards: ["create", "update", "delete"],
  posts: [
    "update",
    "delete",
    "move",
    "lock",
    "archive",
    "status",
    "merge",
    // Create a post attributed to a customer (on-behalf), manager and above.
    "createOnBehalf",
  ],
  comments: ["delete"],
  changelog: ["create", "update", "publish", "delete"],
  "changelog-categories": ["create", "update", "delete"],
  roadmap: ["create", "update", "delete"],
  tags: ["create", "update", "delete"],
  contacts: ["create", "update", "delete"],
  companies: ["create", "update", "delete"],
  webhooks: ["manage"],
  integrations: ["manage"],
} as const satisfies Record<string, readonly string[]>;

type PermissionGroups = typeof PERMISSION_ACTIONS;

type PermissionForGroups<Groups extends Record<string, PermissionActions>> = {
  [Resource in keyof Groups & string]:
    | `${Resource}.${Groups[Resource][number]}`
    | `${Resource}.*`;
}[keyof Groups & string];

export type Permission = PermissionForGroups<PermissionGroups>;

export const PERMISSIONS = [
  ...createPermissions("workspace", PERMISSION_ACTIONS.workspace),
  ...createPermissions("members", PERMISSION_ACTIONS.members),
  ...createPermissions("billing", PERMISSION_ACTIONS.billing),
  ...createPermissions("site", PERMISSION_ACTIONS.site),
  ...createPermissions("boards", PERMISSION_ACTIONS.boards),
  ...createPermissions("posts", PERMISSION_ACTIONS.posts),
  ...createPermissions("comments", PERMISSION_ACTIONS.comments),
  ...createPermissions("changelog", PERMISSION_ACTIONS.changelog),
  ...createPermissions(
    "changelog-categories",
    PERMISSION_ACTIONS["changelog-categories"]
  ),
  ...createPermissions("roadmap", PERMISSION_ACTIONS.roadmap),
  ...createPermissions("tags", PERMISSION_ACTIONS.tags),
  ...createPermissions("contacts", PERMISSION_ACTIONS.contacts),
  ...createPermissions("companies", PERMISSION_ACTIONS.companies),
  ...createPermissions("webhooks", PERMISSION_ACTIONS.webhooks),
  ...createPermissions("integrations", PERMISSION_ACTIONS.integrations),
] satisfies readonly Permission[];

export type PermissionDefinition = {
  /** Short human label, used in docs and future settings UI. */
  readonly label: string;
  /** What the permission allows. */
  readonly description: string;
  /** True when the action also requires a resource-level ownership check. */
  readonly resourceScoped?: boolean;
};

const RESOURCE_SCOPED_PERMISSIONS = new Set<Permission>([
  "posts.update",
  "posts.delete",
  "tags.update",
  "tags.delete",
]);

const humanize = (value: string): string =>
  value.charAt(0).toUpperCase() + value.slice(1);

const permissionDefinition = (permission: Permission): PermissionDefinition => {
  const separator = permission.indexOf(".");
  const resource = permission.slice(0, separator);
  const action = permission.slice(separator + 1);
  const isWildcard = action === "*";

  return {
    label: isWildcard
      ? `All ${humanize(resource)}`
      : `${humanize(action)} ${humanize(resource)}`,
    description: isWildcard
      ? `All permissions for ${resource}.`
      : `${humanize(action)} ${resource}.`,
    ...(RESOURCE_SCOPED_PERMISSIONS.has(permission) && {
      resourceScoped: true,
    }),
  };
};

export const PERMISSION_CATALOG =
  /* SAFETY: every row carries a Permission key and a matching definition. */
  Object.fromEntries(
    PERMISSIONS.map((permission) => [
      permission,
      permissionDefinition(permission),
    ])
  ) as Record<Permission, PermissionDefinition>;
