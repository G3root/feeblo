import { useParams } from "@tanstack/react-router";

export const useOrganizationId = (): string => {
  const organizationId = useParams({
    strict: false,
    select(params) {
      return params?.organizationId;
    },
  });
  if (!organizationId) {
    throw new Error("Organization ID is required");
  }

  return organizationId;
};
