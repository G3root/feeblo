import { getRuntimePublicEnv } from "@feeblo/web-shared/runtime-public-env";
import { eq, useLiveQuery } from "@tanstack/react-db";

import { useDashboardCollections } from "~/providers/dashboard-collections-provider";

import { useOrganizationId } from "./use-organization-id";

const { appRootDomain } = getRuntimePublicEnv();

export const useSite = () => {
  const organizationId = useOrganizationId();
  const { siteCollection } = useDashboardCollections();

  const { data: site } = useLiveQuery({
    // Read by ~24 dashboard surfaces; the explicit key keeps the hook off the
    // per-render identity path.
    queryKey: ["site", siteCollection.id, organizationId],
    query: (q) =>
      q
        .from({ site: siteCollection })
        .where(({ site }) => eq(site.organizationId, organizationId))
        .findOne(),
  });

  return site;
};

const getSiteUrl = (subdomain: string) => {
  return subdomain
    ? `${location.protocol}//${subdomain}.${appRootDomain}`
    : undefined;
};

export const usePublicSiteUrl = () => {
  const site = useSite();
  if (!site?.subdomain) {
    return undefined;
  }
  return getSiteUrl(site.subdomain);
};
