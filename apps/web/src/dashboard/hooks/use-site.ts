import { eq, useLiveQuery } from "@tanstack/react-db";
import { siteCollection } from "~/lib/collections";
import { getRuntimePublicEnv } from "~/lib/runtime-public-env";
import { useOrganizationId } from "./use-organization-id";

const { appRootDomain } = getRuntimePublicEnv();

export const useSite = () => {
  const organizationId = useOrganizationId();

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
