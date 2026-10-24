import { hasWindow } from "@feeblo/utils/runtime-kind";
import type { AnalyticsClient } from "@feeblo/web-shared/analytics-provider";
import { useResolvedAuth } from "@feeblo/web-shared/auth-context";
import { setErrorReportingUser } from "@feeblo/web-shared/error-reporting";
import { getRuntimePublicEnv } from "@feeblo/web-shared/runtime-public-env";
import { useRouter } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { z } from "zod";

/**
 * Product analytics, following the rules `UsefulSoftwareCo/executor` applies
 * to its dashboard:
 *
 * - `autocapture` and the SDK's own pageview, pageleave, exception and
 *   performance capture are off. Every event is explicit and carries only
 *   the properties its call site declares; identity attaches through
 *   `identify`/`group`, never as event properties.
 * - URLs never reach PostHog. `before_send` deletes every URL-shaped
 *   property, including the initial-person properties on `$set`/`$set_once`
 *   that would otherwise carry a first-visit invitation token or OAuth code,
 *   and this file records a route category instead of a path.
 * - Session replay starts only for a confirmed signed-in session and stops
 *   before sign-out, so a login page or a stale session is never recorded.
 *   All text and inputs are masked; `data-ph-block` excludes an element.
 * - The typed `trackEvent` catalog in `@feeblo/web-shared/analytics-provider`
 *   is still the only way product events are named.
 */
type PostHogInstance = typeof import("posthog-js").default;

const env = getRuntimePublicEnv();

const posthogKey = env.posthogKey;
const posthogHost = env.posthogHost ?? "https://us.i.posthog.com";

/** URL-shaped properties PostHog adds on every event and person channel. */
const deniedUrlProperties = [
  "$current_url",
  "$initial_current_url",
  "$referrer",
  "$initial_referrer",
  "$pathname",
  "$session_entry_url",
  "$session_entry_referrer",
  "$session_exit_url",
];

let client: PostHogInstance | null = null;
let loadPromise: Promise<PostHogInstance | null> | null = null;
let started = false;
let identified = false;
// Calls made before the SDK finishes loading (early pageviews, identify on
// fast sessions). Flushed in order once the dynamic import resolves.
const pendingCalls: Array<(posthog: PostHogInstance) => void> = [];

/** Deployment identity attached to every event, never to the person profile. */
const deploymentProperties = () => ({
  product_version: "1",
  surface: "dashboard",
  release: env.appRelease ?? "dev",
  environment:
    env.sentryEnvironment ??
    (import.meta.env.DEV ? "development" : "production"),
});

const updateReplay = () => {
  if (!started) return;
  if (identified) {
    posthogReplayStart();
  } else {
    posthogReplayStop();
  }
};

const posthogReplayStart = () => {
  client?.startSessionRecording();
};

const posthogReplayStop = () => {
  client?.stopSessionRecording();
};

function ensurePostHog(): Promise<PostHogInstance | null> {
  if (!hasWindow() || !posthogKey) {
    return Promise.resolve(null);
  }
  if (!loadPromise) {
    loadPromise = import("posthog-js")
      .then(({ default: posthog }) => {
        if (!posthog.__loaded) {
          posthog.init(posthogKey, {
            api_host: posthogHost,
            defaults: "2026-05-30",
            person_profiles: "identified_only",
            // Recording is enabled per session by `updateReplay`, not at init.
            disable_session_recording: true,
            autocapture: false,
            capture_pageview: false,
            capture_pageleave: false,
            capture_exceptions: false,
            capture_performance: false,
            persistence: "localStorage",
            property_denylist: deniedUrlProperties,
            session_recording: {
              maskAllInputs: true,
              // The dashboard renders customer PII as ordinary text (contact
              // and member emails, post bodies) and shows one-time
              // credentials — API keys and webhook signing secrets — in a
              // `<code>` block, so every text node is masked. Replays keep
              // clicks, navigation, and layout, which is what they are for;
              // `data-ph-block` stays available for elements that must not be
              // recorded at all, and the credential blocks use it.
              maskTextSelector: "*",
              blockSelector: "[data-ph-block]",
            },
            before_send: (event) => {
              if (event === null) return event;
              // property_denylist covers event.properties only. Initial person
              // properties travel on $set_once and $set, and $initial_current_url
              // is the raw first-visit href, including an invitation token or
              // an OAuth code.
              for (const key of deniedUrlProperties) {
                delete event.properties?.[key];
                delete event.$set_once?.[key];
                delete event.$set?.[key];
              }
              return event;
            },
          });
        }
        client = posthog;
        started = true;
        posthog.register(deploymentProperties());
        for (const call of pendingCalls.splice(0)) {
          call(posthog);
        }
        return posthog;
      })
      .catch(() => {
        // Analytics must never break the app; a later event retries the load
        // and flushes whatever queued meanwhile.
        loadPromise = null;
        return null;
      });
  }
  return loadPromise;
}

function withPostHog(call: (posthog: PostHogInstance) => void): void {
  if (client) {
    call(client);
    return;
  }
  pendingCalls.push(call);
  void ensurePostHog();
}

function schedulePostHogLoad(): void {
  if (!hasWindow() || !posthogKey) {
    return;
  }
  const start = () => {
    void ensurePostHog();
  };
  if ("requestIdleCallback" in window) {
    window.requestIdleCallback(start, { timeout: 4000 });
  } else {
    // Bare global: `window` narrows to `never` in this branch because
    // lib.dom types `requestIdleCallback` as always present.
    setTimeout(start, 1);
  }
}

// The SDK (~100 kB with session recording) loads on browser idle, never on
// the critical path. Nothing in the app consumes `@posthog/react`'s context
// (all access goes through the wrappers below), so the static import — which
// drags `posthog-js` into the initial bundle — is gone.
schedulePostHogLoad();

export const posthogAnalyticsClient: AnalyticsClient | undefined =
  hasWindow() && posthogKey
    ? (name: any, properties: any) => {
        withPostHog((posthog) => posthog.capture(name, properties));
      }
    : undefined;

export function identifyPostHog(state: {
  status: "authenticated" | "unauthenticated";
  user?: { id: string; email: string; name: string } | null;
}) {
  if (!posthogKey) {
    return;
  }

  if (state.status === "authenticated" && state.user) {
    const { id, email, name } = state.user;
    identified = true;
    withPostHog((posthog) => {
      const previousUser = posthog.get_property("$user_id");
      if (previousUser !== undefined && previousUser !== id) {
        posthogReplayStop();
        posthog.reset();
        posthog.register(deploymentProperties());
      }
      if (posthog.get_distinct_id() !== id) {
        // The opaque user id is the identity; email and name are properties
        // so a later profile change does not mint a new person.
        posthog.identify(id, { email, name });
      }
      updateReplay();
    });
  } else if (state.status === "unauthenticated") {
    identified = false;
    withPostHog((posthog) => {
      posthogReplayStop();
      if (posthog.get_property("$user_id")) {
        posthog.reset();
        posthog.register(deploymentProperties());
      }
    });
  }
}

export function groupPostHogOrganization(organizationId: string) {
  if (posthogKey) {
    withPostHog((posthog) => posthog.group("organization", organizationId));
  }
}

/**
 * A route category for a dashboard path.
 *
 * The organization id is the first URL segment and is deliberately never
 * read: it identifies a tenant, not a page. Sub-pages collapse to a fixed
 * vocabulary so a customer name or a resource id cannot become a PostHog
 * property.
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

/** Record resolved SPA navigation without a path, search parameters, or fragment. */
export const capturePageview = (pathname: string) => {
  updateReplay();
  if (started)
    withPostHog((posthog) =>
      posthog.capture("$pageview", pageContext(pathname))
    );
};

const operationFailed = z.object({
  error_type: z.string().max(80),
  page_id: z.string().optional(),
  tags: z.record(z.string(), z.string()).optional(),
});

/**
 * Product-level failure signal, emitted by the error-reporting client for the
 * same failure Sentry captures. The two events share `error_type` so a
 * support thread can move between them.
 */
const listenForOperations = () => {
  window.addEventListener("feeblo:operation-failed", (event) => {
    if (!(event instanceof CustomEvent)) return;
    const detail = operationFailed.safeParse(event.detail);
    if (!detail.success) return;
    withPostHog((posthog) =>
      posthog.capture("browser_operation_failed", {
        ...detail.data,
        ...pageContext(window.location.pathname),
      })
    );
  });
};

// The listener needs no SDK: `withPostHog` queues until the module loads, and
// the event listener itself is cheap.
if (hasWindow() && posthogKey) listenForOperations();

/**
 * Identifies the PostHog person once the auth session is confirmed.
 *
 * Mounted inside `AuthProvider` so it can read the authoritative session;
 * it deliberately ignores the display-only hint (the atom's resolved response
 * always replaces it).
 */
export function PostHogIdentify() {
  const state = useResolvedAuth();
  const status = state.status;
  // Only a confirmed session identifies: the display-only hint has no id and
  // may belong to a session that already ended. Primitive deps keep the
  // effect from re-firing on every atom evaluation, which returns a fresh
  // object.
  const session = status === "authenticated" ? state.data : null;
  const userId = session?.user.id ?? null;
  const userEmail = session?.user.email ?? null;
  const userName = session?.user.name ?? null;

  useEffect(() => {
    if (status === "loading") {
      return;
    }
    if (status === "authenticated" && userId && userEmail) {
      identifyPostHog({
        status,
        user: { id: userId, email: userEmail, name: userName ?? "" },
      });
      setErrorReportingUser({ id: userId });
    } else if (status === "unauthenticated") {
      identifyPostHog({ status });
      setErrorReportingUser(null);
    }
  }, [status, userId, userEmail, userName]);

  return null;
}

/** One `$pageview` per resolved path, with no path in the payload. */
export function PostHogPageviews() {
  const router = useRouter();
  const lastPath = useRef<string | undefined>(undefined);
  useEffect(() => {
    const capture = () => {
      const path = window.location.pathname;
      // The initial resolve fires `onResolved` after mount; record the first
      // path once.
      if (path === lastPath.current) return;
      lastPath.current = path;
      capturePageview(path);
    };
    capture();
    return router.subscribe("onResolved", capture);
  }, [router]);
  return null;
}

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
