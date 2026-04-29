import { eq, useLiveQuery } from "@tanstack/react-db";
import { workspacePlanCollection } from "~/lib/collections";
import { useOrganizationId } from "./use-organization-id";

export const usePlan = () => {
  const organizationId = useOrganizationId();

  const query = useLiveQuery(
    (q) =>
      q
        .from({ plan: workspacePlanCollection })
        .where(({ plan }) => eq(plan.organizationId, organizationId))
        .findOne(),
    [organizationId]
  );

  return query;
};
