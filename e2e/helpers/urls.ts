/**
 * The web origin for this Playwright worker.
 *
 * `e2e/fixtures.ts` sets `E2E_BASE_URL` from the worker's own server before
 * any test runs, so callers must read it at call time. A module-level constant
 * would capture the shared default instead of the worker's port.
 */
export const webUrl = (): string =>
  process.env.E2E_BASE_URL ?? "http://localhost:3101";

/** The API origin for this Playwright worker; see `webUrl`. */
export const apiUrl = (): string =>
  process.env.E2E_API_URL ?? "http://localhost:3100";

/**
 * The public board URL for a workspace. Workspace names double as subdomains
 * (lowercased, spaces replaced with dashes).
 */
export function publicBoardUrl(workspaceName: string): string {
  const subdomain = workspaceName.toLowerCase().replaceAll(" ", "-");
  const url = new URL(webUrl());
  return `${url.protocol}//${subdomain}.${url.hostname}${url.port ? `:${url.port}` : ""}`;
}

/** A public-board host that no workspace owns; the site lookup fails there. */
export function unknownPublicBoardUrl(): string {
  const url = new URL(webUrl());
  return `${url.protocol}//does-not-exist.${url.hostname}${url.port ? `:${url.port}` : ""}`;
}
