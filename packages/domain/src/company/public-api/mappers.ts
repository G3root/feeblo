import type { PublicApiCompanySource } from "./repository";
import type { TPublicApiCompany } from "./schema";

/**
 * A company as the company endpoints return it.
 *
 * Like the tag detail mapper and unlike the post mappers, this takes no
 * context: nothing in a company is derived from the application URL or the
 * workspace, and taking a context that is never read would invite the next
 * field to be composed from it without thinking about what a machine key is
 * allowed to see. The contacts who belong to the company have no name here to
 * be passed through.
 */
export const toPublicApiCompany = (
  company: PublicApiCompanySource
): TPublicApiCompany => ({
  id: company.id,
  name: company.name,
  externalId: company.externalId,
  avatar: company.avatar,
  externalCreatedAt: company.externalCreatedAt,
  source: company.source,
  createdAt: company.createdAt,
  updatedAt: company.updatedAt,
});
