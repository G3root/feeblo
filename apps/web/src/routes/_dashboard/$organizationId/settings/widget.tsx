import { useTheme } from "@feeblo/ui/theme-provider";
import { hasPermission, usePolicy } from "@feeblo/web-shared/use-policy";
import { createFileRoute } from "@tanstack/react-router";

import { SettingsAccessDenied } from "~/features/settings/components/settings-access-denied";
import { SettingsLayout } from "~/features/settings/components/settings-layout";
import { WidgetBuilder } from "~/features/widget/components/widget-builder";
import { WidgetIdentifyUsers } from "~/features/widget/components/widget-identify-users";
import { WidgetInstall } from "~/features/widget/components/widget-install";
import { WidgetPreview } from "~/features/widget/components/widget-preview";
import { WidgetStoreProvider } from "~/features/widget/lib/widget-store";
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

  return (
    <WidgetStoreProvider defaultValue={resolvedTheme}>
      <SettingsLayout.Root size="large">
        <SettingsLayout.Header>
          <SettingsLayout.HeaderTitle>Widget</SettingsLayout.HeaderTitle>
          <SettingsLayout.HeaderDescription>
            Choose which modules the widget shows, where the launcher sits, and
            its theme. Preview the real embed, then copy the install snippet for
            your site. Connect your signed-in users so their posts are tied to
            their account.
          </SettingsLayout.HeaderDescription>
        </SettingsLayout.Header>
        <SettingsLayout.Content>
          <div className="grid items-start gap-8 xl:grid-cols-[minmax(0,1fr)_440px]">
            <div className="flex min-w-0 flex-col gap-4">
              <WidgetBuilder />
              <WidgetInstall organizationId={organizationId} />
              <WidgetIdentifyUsers organizationId={organizationId} />
            </div>
            <div className="self-start xl:sticky xl:top-4">
              <WidgetPreview organizationId={organizationId} />
            </div>
          </div>
        </SettingsLayout.Content>
      </SettingsLayout.Root>
    </WidgetStoreProvider>
  );
}
