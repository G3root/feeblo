import { useTheme } from "@feeblo/ui/theme-provider";
import { hasPermission, usePolicy } from "@feeblo/web-shared/use-policy";
import { createFileRoute } from "@tanstack/react-router";
import { useReducer } from "react";

import { SettingsAccessDenied } from "~/features/settings/components/settings-access-denied";
import { SettingsLayout } from "~/features/settings/components/settings-layout";
import { WidgetBuilder } from "~/features/widget/components/widget-builder";
import { WidgetInstall } from "~/features/widget/components/widget-install";
import { WidgetPreview } from "~/features/widget/components/widget-preview";
import {
  createWidgetDraft,
  widgetDraftReducer,
  widgetEmbedConfig,
} from "~/features/widget/lib/widget-config";
import { useOrganizationId } from "~/hooks/use-organization-id";

export const Route = createFileRoute(
  "/_dashboard/$organizationId/settings/widget"
)({
  component: WidgetSettingsRoute,
});

function WidgetSettingsRoute() {
  const organizationId = useOrganizationId();
  const { allowed, isPending } = usePolicy(
    hasPermission(organizationId, "site.update")
  );

  if (isPending) {
    return null;
  }
  if (!allowed) {
    return <SettingsAccessDenied />;
  }

  return <WidgetSettings organizationId={organizationId} />;
}

function WidgetSettings({ organizationId }: { organizationId: string }) {
  const { resolvedTheme } = useTheme();
  const [draft, dispatch] = useReducer(
    widgetDraftReducer,
    resolvedTheme,
    createWidgetDraft
  );
  const config = widgetEmbedConfig(draft);
  // The dashboard and the widget iframe are served by the same deployment, so
  // the page's own origin is the host the snippet should point at.
  const target = { baseUrl: window.location.origin, organizationId };

  return (
    <SettingsLayout.Root size="large">
      <SettingsLayout.Header>
        <SettingsLayout.HeaderTitle>Widget</SettingsLayout.HeaderTitle>
        <SettingsLayout.HeaderDescription>
          Configure the embedded feedback widget, preview it, then copy the
          setup for a developer or a coding agent.
        </SettingsLayout.HeaderDescription>
      </SettingsLayout.Header>
      <SettingsLayout.Content>
        <div className="grid items-start gap-8 xl:grid-cols-[minmax(0,1fr)_440px]">
          <div className="flex min-w-0 flex-col gap-4">
            <WidgetBuilder dispatch={dispatch} draft={draft} />
            <WidgetInstall
              config={config}
              organizationId={organizationId}
              target={target}
            />
          </div>
          <div className="self-start xl:sticky xl:top-4">
            <WidgetPreview config={config} organizationId={organizationId} />
          </div>
        </div>
      </SettingsLayout.Content>
    </SettingsLayout.Root>
  );
}
