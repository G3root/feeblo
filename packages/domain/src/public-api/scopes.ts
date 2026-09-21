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
 * Scopes are part of the versioned public contract: adding one is additive,
 * narrowing or renaming one is a breaking change.
 */

/** Scope statements in the shape the api-key plugin stores and returns. */
export type PublicApiScopeStatements = {
  readonly [resource: string]: readonly string[];
};

/**
 * The scopes every new key receives. v1 exposes only reads, so a key is
 * created with exactly these and never gains more afterwards; write scopes
 * will be introduced as explicit, separately granted scopes when writes ship.
 */
export const PUBLIC_API_DEFAULT_SCOPES = {
  boards: ["read"],
  posts: ["read"],
} as const satisfies PublicApiScopeStatements;

export type PublicApiScope = "boards.read" | "posts.read";

/**
 * Mutable copy of the default scopes, for APIs typed as
 * `Record<string, string[]>` (the api-key plugin's statement shape).
 */
export const toPublicApiScopeStatements = (
  statements: PublicApiScopeStatements
): Record<string, string[]> =>
  Object.fromEntries(
    Object.entries(statements).map(([resource, actions]) => [
      resource,
      [...actions],
    ])
  );

const SCOPE_SEPARATOR = ".";

const splitScope = (scope: PublicApiScope): [string, string] => {
  const separator = scope.indexOf(SCOPE_SEPARATOR);
  return [scope.slice(0, separator), scope.slice(separator + 1)];
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
