import type { TEntitySource } from "@feeblo/domain-contracts/entity-source";

import type { TPublicApiCompany, TPublicApiCompanySourceType } from "./schema";

/**
 * What a company mapper is allowed to read.
 *
 * Narrow for the same reason as the post and tag sources: the company row also
 * carries `organizationId`, and a mapper that could accept the repository's row
 * could pass it through. The source names the published fields only, and
 * `toCompanySource` is the only bridge from the repository row to it.
 */
export type PublicApiCompanySource = {
  readonly id: string;
  readonly name: string;
  readonly externalId: string | null;
  readonly avatar: string | null;
  readonly externalCreatedAt: Date | null;
  readonly source: TPublicApiCompanySourceType;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};

/** Narrows a repository row to the fields a public response may name. */
export const toCompanySource = (row: {
  readonly id: string;
  readonly name: string;
  readonly externalId: string | null;
  readonly avatar: string | null;
  readonly externalCreatedAt: Date | null;
  readonly source: TEntitySource;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}): PublicApiCompanySource => ({
  avatar: row.avatar,
  createdAt: row.createdAt,
  externalCreatedAt: row.externalCreatedAt,
  externalId: row.externalId,
  id: row.id,
  name: row.name,
  source: row.source,
  updatedAt: row.updatedAt,
});

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
