import type { AnalyticsClient } from "@feeblo/web-shared/analytics";
import { getRuntimePublicEnv } from "@feeblo/web-shared/runtime-public-env";
import { PostHogProvider as PostHogReactProvider } from "@posthog/react";
import posthog from "posthog-js";

const env = getRuntimePublicEnv();

const posthogKey = env.posthogKey;
const posthogHost = env.posthogHost ?? "https://us.i.posthog.com";

function initPostHog() {
  if (!posthogKey || posthog.__loaded) {
    return;
  }

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

initPostHog();

export const posthogAnalyticsClient: AnalyticsClient | undefined =
  typeof window !== "undefined" && posthogKey
    ? // biome-ignore lint/suspicious/noExplicitAny: <explanation>
      (name: any, properties: any) => posthog.capture(name, properties)
    : undefined;

export function identifyPostHog(state: {
  status: "authenticated" | "unauthenticated";
  user?: { email: string; name: string } | null;
}) {
  if (!posthogKey) {
    return;
  }

  if (state.status === "authenticated" && state.user) {
    posthog.identify(state.user.email, {
      email: state.user.email,
      name: state.user.name,
    });
  } else if (state.status === "unauthenticated") {
    posthog.reset();
  }
}

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  if (!posthogKey) {
    return <>{children}</>;
  }

  return (
    <PostHogReactProvider client={posthog}>{children}</PostHogReactProvider>
  );
}
