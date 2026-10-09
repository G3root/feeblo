import { createFileRoute } from "@tanstack/react-router";

import { DataSettingsPage } from "~/features/data-transfer/components/data-settings-page";

export const Route = createFileRoute(
  "/_dashboard/$organizationId/settings/data"
)({
  component: DataSettingsPage,
});
