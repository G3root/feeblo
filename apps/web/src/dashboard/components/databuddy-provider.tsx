import {
  getIds,
  identify as identifyTracker,
  init,
  reset as resetTracker,
  setGlobalProperties,
  track,
} from "@databuddy/sdk";
import { hasWindow } from "@feeblo/utils/runtime-kind";
import type {
  AnalyticsClient,
  AnalyticsEventName,
  AnalyticsEvents,
} from "@feeblo/web-shared/analytics-provider";
import { useResolvedAuth } from "@feeblo/web-shared/auth-context";
import { setErrorReportingUser } from "@feeblo/web-shared/error-reporting";
import { getRuntimePublicEnv } from "@feeblo/web-shared/runtime-public-env";
import { useActorRef } from "@xstate/react";
import { useEffect, type ReactNode } from "react";
import { z } from "zod";

import { createAnalyticsIdentityMachine } from "./analytics-identity-machine";

// ---------------------------------------------------------------------------
// Product analytics, backed by Databuddy.
//
// The typed `trackEvent` catalog in `@feeblo/web-shared/analytics-provider` is
// still the only way product events are named; this module only supplies the
// sink. Databuddy is URL-centric where PostHog was property-centric, so the
// privacy rules the PostHog wiring enforced are re-expressed against its own
// controls:
//
// - `autocapture` is off. Rage/dead clicks, outgoing links, Web Vitals and
//   JavaScript errors are all Sentry's or nobody's job; every Databuddy event
//   is either an automatic pageview or an explicit `trackEvent`.
// - Pageviews are the tracker's own: it records one per route change, with the
//   path. `maskPaths` is what keeps a tenant identifier and a resource slug out
//   of that path — see `maskedPaths` below, which is the one place URL exposure
//   is decided. Query strings and fragments are never part of the recorded
//   path, so an invitation token or an OAuth code cannot arrive through it.
// - Session replay is OFF. The PostHog wiring started recording only for a
//   confirmed session; Databuddy's browser SDK loads the recorder with `init()`
//   and `startSessionRecording()` is a no-op, so the only way to gate it is to
//   initialise the tracker after the session resolves — which tears down the
//   tracker and records a second pageview for the landing route. Recording is
//   therefore a product decision to make deliberately (`replay: { maskText:
//   true }` below records every dashboard session, including `/register` and
//   `/reset-password`, because those routes live inside this boundary), not
//   something to switch on as a side effect of a migration.
// - Identity is the machine in `./analytics-identity-machine`, never event
//   properties. It is a machine rather than an effect because the states are
//   real — "the tracker holds a profile" is the only state a sign-out may reset
//   — and the three ways to get that wrong (reset on a cold anonymous load,
//   reset twice, identify a second user before forgetting the first) are
//   transitions a test can walk. The tracker restores a profile from its own
//   storage on load, so the machine also asks what the tracker already holds
//   before deciding a reset is owed. The workspace is the one deliberate
//   exception to "no identifiers in events": `organization_id` is set as a
//   global property, because Databuddy's browser SDK has no group entity and a
//   workspace dimension is the whole point of a B2B product's analytics. That
//   id is opaque, and `reset` clears it with the session.
//
// The tracker is loaded with `init()` rather than `<DatabuddyProvider>`. The
// provider also mounts Databuddy's feature-flag manager, which fetches on mount
// with the signed-in user's email in its context — a second vendor endpoint
// receiving identity data for a subsystem this app does not use. `init()`
// tracks, and the effect below does the identify/reset the provider would have
// done.
//
// BROWSER-ONLY, exactly like the PostHog wiring: a deployment without a client
// ID gets no client at all, so `trackEvent` stays a no-op instead of queueing
// events the tracker will never flush.
// ---------------------------------------------------------------------------

const env = getRuntimePublicEnv();

const clientId = env.databuddyClientId;

// Route shapes whose dynamic segments are never recorded.
//
// Databuddy replaces a wildcard segment with the pattern's own literal text, so
// a pattern that is a single wildcard masks only the leading segment (the
// organization id) and keeps the rest of the path readable, while a longer
// pattern masks the board and post slugs as well. The FIRST matching pattern
// wins, so the specific ones come before the catch-all. Keep this list in sync
// with `apps/web/src/routes/_dashboard`.
const maskedPaths = [
  "/*/post/*/*",
  "/*/board/*/view/*",
  "/*/board/*",
  "/*/changelog/edit/*",
  "/*/feedback/view/*",
  "/*/roadmap/*",
  "/*/company/*",
  "/*/contact/*",
  "/*/settings/data/imports/*",
  "/*/settings/webhooks/*",
  "/*",
];

// `track`'s overload set is a mapped type over the event name, which a generic
// parameter cannot resolve into; `trackEvent`'s signature correlates the name
// with its property bag, so the sink borrows that correlation and hands the
// pair back one at a time.
export const databuddyAnalyticsClient: AnalyticsClient | undefined =
  hasWindow() && clientId
    ? <Name extends AnalyticsEventName>(
        name: Name,
        properties: AnalyticsEvents[Name]
      ) => {
        track(name, { ...properties });
      }
    : undefined;

/**
 * Tag every later event with the workspace the actor is in.
 *
 * Databuddy has no group entity in the browser SDK, so the organization is a
 * global property rather than a `group()` call. `DashboardAnalytics` calls the
 * SDK's `reset()` on sign-out, and that clears global properties with the
 * profile, so an id cannot outlive the session that set it.
 */
export function setAnalyticsOrganization(organizationId: string) {
  if (clientId !== undefined) {
    setGlobalProperties({ organization_id: organizationId });
  }
}

/**
 * A route category for a dashboard path.
 *
 * The organization id is the first URL segment and is deliberately never
 * read: it identifies a tenant, not a page. Sub-pages collapse to a fixed
 * vocabulary so a customer name or a resource id cannot become a property.
 */
export const pageContext = (pathname: string) => {
  const segments = pathname.split("/").filter(Boolean);
  const section = segments[1] ?? "home";
  const pages = new Set([
    "board",
    "changelog",
    "company",
    "contact",
    "feedback",
    "post",
    "roadmap",
    "settings",
    "over-plan",
    "invitation",
    "register",
  ]);
  const page = pages.has(section) ? section : "home";
  const tab = page === "settings" ? segments[2] : undefined;
  const context = {
    page,
    page_kind: segments.length > 3 ? ("detail" as const) : ("index" as const),
  };
  if (tab !== undefined) Object.assign(context, { tab });
  return context;
};

const operationFailed = z.object({
  error_type: z.string().max(80),
  page_id: z.string().optional(),
  // The event is a DOM event any script on the page can dispatch. Only the
  // boundary this code emits is accepted; an injected script cannot add
  // arbitrary properties to a product event. `{}` is still a valid tags value.
  tags: z
    .object({ boundary: z.literal("route") })
    .strict()
    .optional(),
});

/**
 * Product-level failure signal, emitted by the error-reporting client for the
 * same failure Sentry captures. The two events share `error_type` so a
 * support thread can move between them. The listener needs no SDK: `track`
 * queues until the tracker loads, and the listener itself is cheap.
 */
if (hasWindow() && clientId) {
  window.addEventListener("feeblo:operation-failed", (event) => {
    if (!(event instanceof CustomEvent)) return;
    const detail = operationFailed.safeParse(event.detail);
    if (!detail.success) return;
    track("browser_operation_failed", {
      ...detail.data,
      ...pageContext(window.location.pathname),
    });
  });
}

/**
 * The identity lifecycle wired to the tracker and to error reporting.
 *
 * The two sinks stay together because they are one decision: whoever the
 * tracker believes the visitor is, the error reporter is told the same, and
 * `reset` clears both. `reset` also clears the workspace global property, so a
 * workspace id cannot outlive the profile that set it.
 */
const analyticsIdentityMachine = createAnalyticsIdentityMachine({
  identify: ({ userId, email, name }) => {
    identifyTracker(userId, { email, name });
    setErrorReportingUser({ id: userId });
  },
  forget: () => {
    resetTracker();
    setErrorReportingUser(null);
  },
  // `getIds()` is the current read; `getProfileId()` is deprecated in 3.5.1.
  // Its implementation prefers the running tracker and falls back to the
  // `did_profile` entry the tracker restores from, so it answers correctly
  // before the CDN script has loaded.
  readProfileId: () => getIds().profileId,
});

/**
 * Starts the tracker and keeps its profile in step with the auth session.
 *
 * Mounted inside `AuthProvider` so it can read the authoritative session; it
 * deliberately ignores the display-only hint (the atom's resolved response
 * always replaces it). While the session is loading nothing is identified, so
 * an unresolved read cannot clear a live profile or create an anonymous one.
 */
export function DashboardAnalytics({ children }: { children: ReactNode }) {
  const state = useResolvedAuth();
  const status = state.status;
  const session = status === "authenticated" ? state.data : null;
  const userId = session?.user.id ?? null;
  const userEmail = session?.user.email ?? null;
  const userName = session?.user.name ?? null;
  const pending = status === "loading";

  // `init` both injects the tracker and returns the teardown that stops it.
  // Nothing re-runs it: the deployment's client id does not change at runtime,
  // and a second `init` would count the landing route twice.
  useEffect(() => {
    if (clientId === undefined) return;

    return init({
      clientId,
      apiUrl: env.databuddyApiUrl,
      autocapture: false,
      maskPaths: maskedPaths,
    });
  }, []);

  // The session is the authority and the machine only keeps the tracker in step
  // with it, so `loading` is never sent: an unresolved read must not identify
  // anonymously or clear a live profile.
  const identity = useActorRef(analyticsIdentityMachine);
  useEffect(() => {
    if (pending) return;

    identity.send({
      type: "SESSION",
      session:
        userId === null || userEmail === null
          ? null
          : { userId, email: userEmail, name: userName ?? "" },
    });
  }, [identity, pending, userId, userEmail, userName]);

  return <>{children}</>;
}
