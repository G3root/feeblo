import { eq, useLiveQuery } from "@tanstack/react-db";
import { getRuntimePublicEnv } from "@feeblo/web-shared/runtime-public-env";
import { useDashboardCollections } from "~/providers/dashboard-collections-provider";
import { useOrganizationId } from "./use-organization-id";

const { appRootDomain } = getRuntimePublicEnv();

export const useSite = () => {
  const organizationId = useOrganizationId();
  const { siteCollection } = useDashboardCollections();

  const { data: site } = useLiveQuery(
    (q) =>
      q
        .from({ site: siteCollection })
        .where(({ site }) => eq(site.organizationId, organizationId))
        .findOne(),
    [organizationId]
  );

  return site;
};

const getSiteUrl = (subdomain: string) => {
  return subdomain
    ? `${location.protocol}//${subdomain}.${appRootDomain}`
    : undefined;
};

export const getPublicSiteUrl = () => {
  const site = useSite();
  if (!site?.subdomain) {
    return undefined;
  }
  return getSiteUrl(site.subdomain);
};
