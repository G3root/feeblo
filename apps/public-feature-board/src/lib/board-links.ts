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
