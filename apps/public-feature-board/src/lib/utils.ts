import type { TPostStatusType } from "@feeblo/domain/post-status/schema";

import { m } from "../paraglide/messages.js";

// Fallback labels for the canonical status vocabulary, shown only when a
// workspace has not set a custom `status.label`. Explicit map (not a dynamic
// `m[...]` lookup) so each message stays tree-shakeable.
const postStatusMessages = {
  PENDING: m.seemly_red_mink,
  REVIEW: m.mild_fuzzy_piranha,
  PLANNED: m.due_sharp_anaconda,
  IN_PROGRESS: m.free_polite_lemur,
  COMPLETED: m.fresh_weird_tapir,
  CLOSED: m.full_sad_stingray,
} satisfies Record<TPostStatusType, () => string>;

function isPostStatusType(value: string): value is TPostStatusType {
  return value in postStatusMessages;
}

export function formatPostStatus(status: string) {
  if (isPostStatusType(status)) {
    return postStatusMessages[status]();
  }

  return status
    .toLowerCase()
    .split("_")
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

export function truncate(value: string, maxLength = 180) {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 1).trimEnd()}...`;
}
