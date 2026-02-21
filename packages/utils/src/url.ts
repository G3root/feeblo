import slug from "@sindresorhus/slugify";

export function slugify(str: string) {
  return slug(str, { lowercase: true });
}
