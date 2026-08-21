import { AnalyticsProvider } from "@feeblo/web-shared/analytics-provider";
import { AuthProvider } from "@feeblo/web-shared/auth-context";
import { RouterProvider } from "@tanstack/react-router";

import {
  PostHogIdentify,
  PostHogProvider,
  posthogAnalyticsClient,
} from "./components/posthog-provider";
import { createRouter } from "./router";

const router = createRouter();

export const Dashboard = () => (
  <AnalyticsProvider client={posthogAnalyticsClient}>
    <PostHogProvider>
      <AuthProvider>
        <PostHogIdentify />
        <RouterProvider router={router} />
      </AuthProvider>
    </PostHogProvider>
  </AnalyticsProvider>
);
