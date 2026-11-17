import { createFileRoute } from "@tanstack/react-router";

import { HelpCenterPage } from "@/portal/help-center/help-center-page";

export const Route = createFileRoute("/s/help/")({
  component: HelpCenterPage,
});
