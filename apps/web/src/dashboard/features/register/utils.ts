import { slugify } from "@feeblo/utils/url";

export function toWorkspaceSlug(value: string) {
  return slugify(value);
}
