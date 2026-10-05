import { eq, useLiveQuery } from "@tanstack/react-db";

import { workspacePlanCollection } from "~/lib/collections";

import { useOrganizationId } from "./use-organization-id";

export const usePlan = () => {
  const organizationId = useOrganizationId();

  const query = useLiveQuery({
    // Called from billing, customize, entitlements, and changelog categories,
    // so identity work here repeats with every dashboard surface.
    queryKey: ["plan", workspacePlanCollection.id, organizationId],
    query: (q) =>
      q
        .from({ plan: workspacePlanCollection })
        .where(({ plan }) => eq(plan.organizationId, organizationId))
        .findOne(),
  });

  return query;
};
