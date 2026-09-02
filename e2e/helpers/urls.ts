const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3101";

/**
 * The public board URL for a workspace. Workspace names double as subdomains
 * (lowercased, spaces replaced with dashes).
 */
export function publicBoardUrl(workspaceName: string): string {
  const subdomain = workspaceName.toLowerCase().replaceAll(" ", "-");
  const url = new URL(baseURL);
  return `${url.protocol}//${subdomain}.${url.hostname}${url.port ? `:${url.port}` : ""}`;
}

/** A public-board host that no workspace owns; the site lookup fails there. */
export function unknownPublicBoardUrl(): string {
  const url = new URL(baseURL);
  return `${url.protocol}//does-not-exist.${url.hostname}${url.port ? `:${url.port}` : ""}`;
}
