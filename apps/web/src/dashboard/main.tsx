import { RegistryProvider } from "@effect/atom-react";
import { AnalyticsProvider } from "@feeblo/web-shared/analytics-provider";
import { AuthProvider } from "@feeblo/web-shared/auth-context";
import type { AuthHint } from "@feeblo/web-shared/auth-hint";
import { RouterProvider } from "@tanstack/react-router";

import {
  PostHogIdentify,
  PostHogProvider,
  posthogAnalyticsClient,
} from "./components/posthog-provider";
import { createRouter } from "./router";

const router = createRouter();

export const Dashboard = ({
  initialHint,
}: {
  initialHint: AuthHint | null;
}) => (
  <AnalyticsProvider client={posthogAnalyticsClient}>
    <PostHogProvider>
      <AuthProvider initialHint={initialHint}>
        <PostHogIdentify />
        <RegistryProvider>
          <RouterProvider router={router} />
        </RegistryProvider>
      </AuthProvider>
    </PostHogProvider>
  </AnalyticsProvider>
);
