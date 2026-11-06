import {
  CHANGELOG_STATES,
  type TChangelogState,
} from "@feeblo/domain/changelog/machine";

/**
 * The status list is the lifecycle machine's, not a copy: the dashboard's
 * filter and label maps read the same three states the server's guarded writes
 * do, so a status that leaves the graph cannot linger in a dropdown.
 */
export const CHANGELOG_STATUSES = CHANGELOG_STATES;

export type ChangelogStatus = TChangelogState;

export const CHANGELOG_STATUS_LABELS = {
  draft: "Draft",
  scheduled: "Scheduled",
  published: "Published",
} satisfies Record<ChangelogStatus, string>;
