import { hasWindow } from "@feeblo/utils/runtime-kind";
import type { AnalyticsClient } from "@feeblo/web-shared/analytics-provider";
import { useResolvedAuth } from "@feeblo/web-shared/auth-context";
import { getRuntimePublicEnv } from "@feeblo/web-shared/runtime-public-env";
import { useEffect } from "react";

type PostHogInstance = typeof import("posthog-js").default;

const env = getRuntimePublicEnv();

const posthogKey = env.posthogKey;
const posthogHost = env.posthogHost ?? "https://us.i.posthog.com";

let client: PostHogInstance | null = null;
let loadPromise: Promise<PostHogInstance | null> | null = null;
// Calls made before the SDK finishes loading (early pageviews, identify on
// fast sessions). Flushed in order once the dynamic import resolves.
const pendingCalls: Array<(posthog: PostHogInstance) => void> = [];

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
            disable_session_recording: false,
            session_recording: {
              maskAllInputs: true,
              maskTextSelector: "[data-ph-mask]",
              blockSelector: "[data-ph-block]",
            },
          });
        }
        client = posthog;
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
  user?: { email: string; name: string } | null;
}) {
  if (!posthogKey) {
    return;
  }

  if (state.status === "authenticated" && state.user) {
    const { email, name } = state.user;
    withPostHog((posthog) =>
      posthog.identify(email, {
        email,
        name,
      })
    );
  } else if (state.status === "unauthenticated") {
    withPostHog((posthog) => posthog.reset());
  }
}

export function groupPostHogOrganization(organizationId: string) {
  if (posthogKey) {
    withPostHog((posthog) => posthog.group("organization", organizationId));
  }
}

/**
 * Identifies the PostHog person once the auth session is confirmed.
 *
 * Mounted inside `AuthProvider` so it can read the authoritative session;
 * it deliberately ignores the display-only hint (the atom's resolved response
 * always replaces it).
 */
export function PostHogIdentify() {
  const state = useResolvedAuth();

  useEffect(() => {
    if (state.status !== "loading") {
      identifyPostHog(state);
    }
  }, [state]);

  return null;
}

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
