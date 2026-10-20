import type { TWorkspacePlanCompliance } from "@feeblo/domain/plan-compliance/schema";

/**
 * Settings that belong to the signed-in person rather than the workspace.
 *
 * The gate blocks the workspace, never the member: someone must still be able
 * to change their password or turn off notification email while an owner
 * ignores the plan.
 */
const PERSONAL_SETTINGS_PATHS = new Set([
  "settings/notifications",
  "settings/preferences",
  "settings/profile",
  "settings/security",
]);

/**
 * The path below the workspace segment, or null when this is not that
 * workspace's URL. Trailing slashes are ignored; the organization id is the
 * first real segment of every dashboard path.
 */
const workspacePath = (
  pathname: string,
  organizationId: string
): string | null => {
  const prefix = `/${organizationId}`;

  if (pathname === prefix) {
    return "";
  }

  if (!pathname.startsWith(`${prefix}/`)) {
    return null;
  }

  return pathname.slice(prefix.length + 1).replace(/\/+$/, "");
};

const hasViolation = (
  compliance: TWorkspacePlanCompliance,
  kind: TWorkspacePlanCompliance["violations"][number]["kind"]
): boolean =>
  compliance.violations.some((violation) => violation.kind === kind);

const hasDegraded = (
  compliance: TWorkspacePlanCompliance,
  capability: TWorkspacePlanCompliance["degraded"][number]
): boolean => compliance.degraded.includes(capability);

/**
 * Whether an over-plan workspace may open this path.
 *
 * The rule is: the gate itself, billing, personal settings, and whatever the
 * snapshot says is needed to explain or fix one of this workspace's findings.
 * The allowlist is derived from the snapshot rather than static, so a link
 * inside the gate always lands on a reachable page — and a page for a finding
 * this workspace does not have stays blocked.
 */
export const isOverPlanPathAllowed = (
  pathname: string,
  organizationId: string,
  compliance: TWorkspacePlanCompliance
): boolean => {
  const path = workspacePath(pathname, organizationId);

  if (path === null) {
    return false;
  }

  if (path === "over-plan" || path === "settings/billing") {
    return true;
  }

  if (PERSONAL_SETTINGS_PATHS.has(path)) {
    return true;
  }

  const isBoardOrPostPath =
    path === "board" ||
    path.startsWith("board/") ||
    path === "post" ||
    path.startsWith("post/");

  if (
    isBoardOrPostPath &&
    (hasViolation(compliance, "boards") ||
      hasViolation(compliance, "privateBoards"))
  ) {
    return true;
  }

  if (
    (path === "contact" ||
      path.startsWith("contact/") ||
      path === "company" ||
      path.startsWith("company/")) &&
    hasViolation(compliance, "crmEntries")
  ) {
    return true;
  }

  if (
    path === "settings/changelog-categories" &&
    hasViolation(compliance, "changelogCategories")
  ) {
    return true;
  }

  if (
    path.startsWith("settings/integrations") &&
    hasDegraded(compliance, "integrations")
  ) {
    return true;
  }

  if (path === "settings/developers" && hasDegraded(compliance, "publicApi")) {
    return true;
  }

  if (
    path === "settings/customize" &&
    hasDegraded(compliance, "removeBranding")
  ) {
    return true;
  }

  if (path === "settings/widget" && hasDegraded(compliance, "widgetSso")) {
    return true;
  }

  return false;
};
