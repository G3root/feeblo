export const CHANGELOG_STATUSES = [
  "draft",
  "scheduled",
  "published",
] as const;

export type ChangelogStatus = (typeof CHANGELOG_STATUSES)[number];

export const CHANGELOG_STATUS_LABELS: Record<ChangelogStatus, string> = {
  draft: "Draft",
  scheduled: "Scheduled",
  published: "Published",
};
