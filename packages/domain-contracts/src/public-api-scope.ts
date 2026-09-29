import * as Schema from "effect/Schema";

/**
 * Public API scope vocabulary.
 *
 * A scope is a capability granted to an API key. It lives here, apart from
 * `@feeblo/permissions`, for two reasons: that catalog is shared with the
 * frontend and mutation-oriented (it has no read actions, because read access
 * for a member is implied by membership), and an API key is a machine
 * credential rather than a member. `apiKeys.manage` decides who may grant a
 * scope; a scope decides what a key may do. Those are separate axes.
 *
 * It lives in `@feeblo/domain-contracts` rather than beside the endpoints it
 * guards because the dashboard's key form and the auth plugin's key
 * configuration both read the vocabulary: the browser and the credential layer
 * need the scope names and must not reach into the Public API's server module
 * to get them (see `docs/adr/0006`).
 *
 * Scopes are part of the versioned public contract: adding one is additive,
 * narrowing or renaming one is a breaking change. A write is its own scope
 * rather than an action implied by a read, so a key that only reads a
 * workspace's feedback can never be talked into writing it by a later release.
 */

/** Scope statements in the shape the api-key plugin stores and returns. */
export type PublicApiScopeStatements = {
  readonly [resource: string]: readonly string[];
};

/**
 * Every scope a key can hold: the closed vocabulary that the scope type, the
 * scope schema, and the grant lists below are all checked against. The api-key
 * plugin stores a nested statement shape; that shape is a storage detail
 * derived from this list by `toPublicApiScopeStatements`.
 */
export const PUBLIC_API_SCOPES = [
  "boards.read",
  "posts.read",
  "comments.read",
  "comments.create",
  "comments.update",
  "comments.delete",
  "comments.pin",
  "tags.read",
  "tags.create",
  "tags.update",
  "tags.delete",
  "tags.assign",
  "companies.read",
  "companies.create",
  "companies.update",
  "companies.delete",
  "changelog.read",
  "changelog.create",
  "changelog.update",
  "changelog.delete",
  "changelog.publish",
] as const;

export type PublicApiScope = (typeof PUBLIC_API_SCOPES)[number];

/**
 * The vocabulary as a schema, so a key cannot be created holding a scope that
 * does not exist. A scope typo would otherwise be stored verbatim and only
 * show up as an unexplained `FORBIDDEN_SCOPE` at request time.
 */
export const PublicApiScopeSchema = Schema.Literals(PUBLIC_API_SCOPES);

/**
 * The scopes every new key receives: reads only.
 *
 * `boards.read` is granted although no v1 endpoint requires it yet, so the
 * board-metadata endpoint is additive when it ships.
 */
export const PUBLIC_API_DEFAULT_SCOPES = [
  "boards.read",
  "posts.read",
  "comments.read",
  "tags.read",
  "changelog.read",
] as const satisfies readonly PublicApiScope[];

/**
 * Comment writes, granted explicitly at key creation and never by default.
 *
 * An API key has no user of its own, so every comment it creates is authored
 * on behalf of a customer the request names — the same on-behalf resolution
 * the dashboard uses. `comments.pin` is separate from `comments.update` for the
 * same reason the dashboard's permission model keeps moderation apart from
 * authorship: editing a comment's words and deciding which one sits at the top
 * of a post are different authorities.
 */
export const PUBLIC_API_COMMENT_MANAGEMENT_SCOPES = [
  "comments.create",
  "comments.update",
  "comments.delete",
  "comments.pin",
] as const satisfies readonly PublicApiScope[];

/**
 * Tag writes, granted explicitly at key creation and never by default.
 *
 * Deleting a tag cascades to every post assignment that carried it, and an
 * integration that only reads feedback has no business holding that. The
 * dashboard offers the grant as one choice, so a customer cannot end up with
 * `tags.update` and no way to create the tag it renames, or with
 * `tags.assign` and no way to name the tag it applies.
 *
 * `tags.assign` is separate from `tags.update`: renaming a tag changes what it
 * is called everywhere, while assigning it changes which posts carry it. A key
 * that keeps a workspace's vocabulary tidy is not automatically one that may
 * relabel its feedback.
 */
export const PUBLIC_API_TAG_MANAGEMENT_SCOPES = [
  "tags.create",
  "tags.update",
  "tags.delete",
  "tags.assign",
] as const satisfies readonly PublicApiScope[];

/**
 * The company grant, made explicitly at key creation and never by default.
 *
 * Deleting a company dissolves the account record its contacts point at and
 * cascades away its attribute values, so a key that only reads feedback has no
 * business holding that. The dashboard offers the grant as one choice, so a
 * customer cannot end up with `companies.update` and no way to create the
 * company it renames, or with `companies.delete` and no way to fix a mistake
 * it made.
 *
 * Companies are a different class of data from posts and tags: a company is a
 * customer's own account, not the workspace's content. A key minted to read
 * feedback therefore never learns the customer roster by default either —
 * `companies.read` is part of this group rather than of
 * `PUBLIC_API_DEFAULT_SCOPES` — which is why the group is all four actions.
 */
export const PUBLIC_API_COMPANY_MANAGEMENT_SCOPES = [
  "companies.read",
  "companies.create",
  "companies.update",
  "companies.delete",
] as const satisfies readonly PublicApiScope[];

/**
 * Changelog writes, granted explicitly at key creation and never by default.
 *
 * `changelog.publish` is separate from `changelog.update`: editing an entry is
 * reversible, while publishing it emails everyone subscribed to the workspace
 * changelog and shows up in their inbox. A key created to sync drafts from a
 * CMS must not be able to broadcast a release note by setting `status`, so a
 * publish — a create that starts published, or an update that moves an entry
 * into `published` — needs the scope on its own.
 */
export const PUBLIC_API_CHANGELOG_MANAGEMENT_SCOPES = [
  "changelog.create",
  "changelog.update",
  "changelog.delete",
  "changelog.publish",
] as const satisfies readonly PublicApiScope[];

const SCOPE_SEPARATOR = ".";

const splitScope = (scope: PublicApiScope): [string, string] => {
  const separator = scope.indexOf(SCOPE_SEPARATOR);
  return [scope.slice(0, separator), scope.slice(separator + 1)];
};

/**
 * The plugin's statement shape, grouped from a flat scope list.
 *
 * Takes the flat list rather than the nested shape so that the vocabulary
 * above is the only place a scope name is written down; callers that already
 * hold stored statements (`hasPublicApiScope`) still read the nested form.
 */
export const toPublicApiScopeStatements = (
  scopes: readonly PublicApiScope[]
): Record<string, string[]> => {
  const grouped = new Map<string, string[]>();
  for (const scope of scopes) {
    const [resource, action] = splitScope(scope);
    const actions = grouped.get(resource) ?? [];
    if (!actions.includes(action)) {
      actions.push(action);
    }
    grouped.set(resource, actions);
  }
  return Object.fromEntries(grouped);
};

/** True when `statements` grant `scope`, directly or through a `*` action. */
export const hasPublicApiScope = (
  statements: PublicApiScopeStatements | null | undefined,
  scope: PublicApiScope
): boolean => {
  const [resource, action] = splitScope(scope);
  const granted = statements?.[resource];
  if (!Array.isArray(granted)) {
    return false;
  }
  return granted.includes(action) || granted.includes("*");
};

/** Every scope in `statements`, flattened to `resource.action` form. */
export const listPublicApiScopes = (
  statements: PublicApiScopeStatements | null | undefined
): string[] => {
  if (!statements) {
    return [];
  }

  return Object.entries(statements).flatMap(([resource, actions]) =>
    Array.isArray(actions)
      ? actions.map((action) => `${resource}${SCOPE_SEPARATOR}${action}`)
      : []
  );
};
