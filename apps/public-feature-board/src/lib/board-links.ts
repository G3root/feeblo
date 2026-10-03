/**
 * The board's internal paths.
 *
 * Board hosts fold their pages under the host router's `/s` prefix, which the
 * router's rewrite hides again (`lib/public-board-rewrite` in `apps/web`): the
 * visitor sees `/p/hello` while the router matches `/s/p/hello`. Links and
 * navigations must use the internal spelling, so they all come from here
 * instead of being spelled out at each call site.
 */
export const boardPaths = {
  board: (boardSlug: string) => `/s/b/${boardSlug}`,
  changelog: "/s/changelog",
  changelogEntry: (changelogSlug: string) => `/s/changelog/${changelogSlug}`,
  home: "/s",
  post: (slug: string) => `/s/p/${slug}`,
  roadmap: "/s/roadmap",
  roadmapEntry: (slug: string) => `/s/roadmap/${slug}`,
} as const;

/**
 * The board's public spelling of an internal path.
 *
 * The router's location keeps the internal `/s/...` spelling the rewrite
 * matched, so anything that compares the location against a *visible* href —
 * the navbar's selected state — has to translate both sides onto the visitor's
 * spelling first. A board page never renders outside the `/s` prefix, so an
 * unrecognised path passes through unchanged and stays comparable.
 */
export function toBoardPublicPath(pathname: string): string {
  const internalHome = boardPaths.home;

  if (pathname === internalHome) {
    return "/";
  }

  if (pathname.startsWith(`${internalHome}/`)) {
    return pathname.slice(internalHome.length);
  }

  return pathname;
}
