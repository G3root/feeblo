import { slugify } from "@feeblo/utils/url";

/** The field's shortest allowed subdomain; below it there is nothing to ask. */
export const MIN_SLUG_LENGTH = 4;

export function toWorkspaceSlug(value: string) {
  return slugify(value);
}
