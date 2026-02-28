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

const getSiteUrl = (subdomain: string) => {
  return subdomain
    ? `${location.protocol}//${subdomain}.${location.host}`
    : undefined;
};

export const getPublicSiteUrl = () => {
  const site = useSite();
  if (!site?.subdomain) {
    return undefined;
  }
  return getSiteUrl(site.subdomain);
};
