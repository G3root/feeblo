import { createFileRoute } from "@tanstack/react-router";

import { OverPlanGate } from "~/features/plan-compliance/components/over-plan-gate";

/**
 * The remediation surface an over-plan workspace is redirected to.
 *
 * It sits outside the dashboard and settings layouts on purpose: the gate is
 * the whole screen, and the layouts (and their sidebars) only mount on pages
 * the snapshot allows.
 */
export const Route = createFileRoute("/_dashboard/$organizationId/over-plan")({
  component: OverPlanGate,
  head: () => ({ meta: [{ title: "Over plan" }] }),
});
