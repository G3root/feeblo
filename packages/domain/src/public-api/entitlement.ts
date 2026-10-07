/**
 * The Public API's CRM vocabulary.
 *
 * The protocol — the workspace lock, the count, and the plan decision — lives
 * in `crm-entry/intake.ts`, because the dashboard, on-behalf attribution, and
 * the widget all need the same order. This module keeps only the words the
 * Public API publishes for it: a machine key's remedy for a full CRM is a plan
 * with room, so the refusal is `PLAN_REQUIRES_UPGRADE`, and the message below
 * is the one operators read.
 */

/**
 * The message for a workspace whose plan has no room left.
 *
 * Fixed rather than the policy's own `reason`: that one names the plan and the
 * limit, which is the dashboard's wording for a member looking at their own
 * billing, while this message is the only human-facing explanation a machine
 * key's operator gets and is part of the published contract's vocabulary.
 *
 * Exported because on-behalf attribution discovers the limit deep in identity
 * resolution rather than at the operation boundary, so the operation catches
 * `CrmEntryLimitReachedError` and has to report it in these words rather than
 * invent a second wording for the same limit.
 */
export const crmLimitMessage =
  "This workspace's plan has no room for another CRM entry.";
