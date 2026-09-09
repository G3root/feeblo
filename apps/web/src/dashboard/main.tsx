import { initPostUiI18n, isPostUiI18nInitialized } from "@feeblo/post-ui/i18n";
import { AnalyticsProvider } from "@feeblo/web-shared/analytics-provider";
import { AuthProvider } from "@feeblo/web-shared/auth-context";
import { RouterProvider } from "@tanstack/react-router";

import { getLocale, setLocale } from "@/paraglide/runtime.js";

import {
  PostHogIdentify,
  PostHogProvider,
  posthogAnalyticsClient,
} from "./components/posthog-provider";
import { createRouter } from "./router";

const router = createRouter();

export const Dashboard = () => {
  if (!isPostUiI18nInitialized()) {
    initPostUiI18n({ getLocale, setLocale });
  }

  return (
    <AnalyticsProvider client={posthogAnalyticsClient}>
      <PostHogProvider>
        <AuthProvider>
          <PostHogIdentify />
          <RouterProvider router={router} />
        </AuthProvider>
      </PostHogProvider>
    </AnalyticsProvider>
  );
};
