import type { TPublicApiEndUser } from "./schema";

/**
 * What the end-user mapper is allowed to read.
 *
 * Declared structurally and narrowly on purpose: a mapper cannot accept a
 * dashboard contact row — which carries `email`, `phone`, and the linked
 * account id — and pass it through, and a column added to `contact` cannot
 * reach a public response without being added here first.
 */
export type PublicApiEndUserSource = {
  readonly id: string;
  readonly externalId: string | null;
  readonly name: string | null;
  readonly avatarUrl: string | null;
  readonly companyId: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};

/**
 * The published projection, rebuilt field by field.
 *
 * The name is deliberately not composed into anything and no field is spread:
 * a source that grew an `email` would still not put it in a response.
 */
export const toPublicApiEndUser = (
  endUser: PublicApiEndUserSource
): TPublicApiEndUser => ({
  id: endUser.id,
  externalId: endUser.externalId,
  name: endUser.name,
  avatarUrl: endUser.avatarUrl,
  companyId: endUser.companyId,
  createdAt: endUser.createdAt,
  updatedAt: endUser.updatedAt,
});
