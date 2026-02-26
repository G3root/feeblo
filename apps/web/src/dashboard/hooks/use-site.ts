import { eq, useLiveQuery } from "@tanstack/react-db";
import { siteCollection } from "~/lib/collections";
import { useOrganizationId } from "./use-organization-id";

export const useSite = () => {
  const organizationId = useOrganizationId();

  const { data: site } = useLiveQuery(
    (q) =>
      q
        .from({ site: siteCollection })
        .where(({ site }) => eq(site.organizationId, organizationId))
        .findOne(),
    []
  );

  return site;
};
