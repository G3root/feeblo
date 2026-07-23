import type * as React from "react";

// ---------------------------------------------------------------------------
// Product-analytics seam — same DI shape as ./error-reporting: a module-level
// client set by a provider the HOST mounts, and a free `trackEvent` function
// callsites import directly (works outside React, e.g. oauth-popup callbacks).
// No client mounted (local, self-host, cloudflare, tests) → every call is a
// no-op. Cloud mounts `AnalyticsProvider` with a posthog-backed client.
//
// `AnalyticsEvents` is the single catalog of every product event: names are
// `object_verb` snake_case, properties are snake_case. A callsite with a typo
// or an undeclared property is a type error, so the catalog can't drift from
// the instrumentation.
//
// BROWSER-ONLY by design: during SSR the host mounts no client (cloud's is
// undefined when `window` is absent), and on shared-module-scope runtimes
// (Cloudflare Workers) every SSR render resets the singleton to null. Server-
// side product events need their own seam — do not route them through this one.
//
// PROPERTY RULES — properties must never carry:
//   - secrets, tokens, credential values, copied clipboard contents
//   - emails, person/org names, or any user-entered free text
//   - connection names or tool ADDRESSES (both embed user-entered label text;
//     integration slugs and spec-derived tool names are fine)
//   - policy patterns (user-entered globs) — use `pattern_kind` instead
// Identity attaches via posthog identify/group (the host's concern), never as
// event properties.
// ---------------------------------------------------------------------------

export interface AnalyticsEvents {
  // ── Changelog ────────────────────────────────────────────────────────────
  changelog_created: { success: boolean };
  changelog_deleted: { success: boolean };
  changelog_saved: {
    status: "draft" | "published" | "scheduled";
    success: boolean;
  };

  // ── CRM ──────────────────────────────────────────────────────────────────
  company_created: { success: boolean };
  company_deleted: { success: boolean };
  company_updated: { success: boolean };
  contact_created: { success: boolean };
  contact_deleted: { success: boolean };
  contact_updated: { success: boolean };
  custom_attribute_created: {
    entity_type: "company" | "contact";
    success: boolean;
  };
  custom_attribute_deleted: {
    entity_type: "company" | "contact";
    success: boolean;
  };
  custom_attribute_updated: {
    entity_type: "company" | "contact";
    success: boolean;
  };
  org_created: { success: boolean };
  org_deleted: { success: boolean };
  org_invitation_accepted: { success: boolean };
  org_invitation_revoked: { success: boolean };
  org_logo_updated: { action: "uploaded" | "removed"; success: boolean };
  org_member_invited: { role: string; success: boolean };
  org_member_removed: { success: boolean };
  org_member_role_changed: { role: string; success: boolean };

  // ── Organization ─────────────────────────────────────────────────────────
  org_renamed: { success: boolean };
  org_switched: { success: boolean };

  // ── Posts ────────────────────────────────────────────────────────────────
  post_created: { source: PostCreationSource; success: boolean };
  post_deleted: { mode: "single" | "bulk"; success: boolean };
  post_lock_changed: { locked: boolean; success: boolean };
  post_updated: {
    field: "board" | "content" | "status" | "title";
    success: boolean;
  };

  signed_out: {};

  // ── SSO ──────────────────────────────────────────────────────────────────
  sso_secret_copied: { success: boolean };
  sso_secret_revoked: { success: boolean };
  sso_secret_rotated: { success: boolean };
}

export type PostCreationSource =
  | "board_column"
  | "board_empty_state"
  | "board_list"
  | "dashboard";

export type AnalyticsEventName = keyof AnalyticsEvents;

/**
 * The host-supplied sink. Cloud backs this with `posthog.capture`; hosts that
 * mount no provider get the no-op default.
 */
export type AnalyticsClient = <Name extends AnalyticsEventName>(
  name: Name,
  properties: AnalyticsEvents[Name]
) => void;

let currentAnalyticsClient: AnalyticsClient | null = null;

/**
 * Imperative injection point — what `AnalyticsProvider` uses, and the hook for
 * non-React hosts (or tests). Pass `null` to restore the no-op default.
 */
export const setAnalyticsClient = (client: AnalyticsClient | null): void => {
  currentAnalyticsClient = client;
};

/**
 * Record one product event. Safe to call from anywhere (React handlers,
 * Effect callbacks, plain modules); a host without a mounted client makes
 * this a no-op. Events with no properties may omit the second argument.
 */
export const trackEvent = <Name extends AnalyticsEventName>(
  name: Name,
  ...rest: {} extends AnalyticsEvents[Name]
    ? [properties?: AnalyticsEvents[Name]]
    : [properties: AnalyticsEvents[Name]]
): void => {
  currentAnalyticsClient?.(name, rest[0] ?? ({} as AnalyticsEvents[Name]));
};

/**
 * Declarative mount for React hosts — sets the module-level client during
 * render, exactly like `FrontendErrorReporterProvider` does for error
 * reporting. Mount once at the app root, ABOVE any tree that fires events
 * (in cloud that is the document root, not ExecutorProvider, because the
 * login/onboarding routes render outside the authenticated shell).
 */
export const AnalyticsProvider = (
  props: React.PropsWithChildren<{ client?: AnalyticsClient }>
) => {
  currentAnalyticsClient = props.client ?? null;
  return <>{props.children}</>;
};
