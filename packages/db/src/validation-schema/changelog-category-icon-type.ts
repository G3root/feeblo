import * as S from "effect/Schema";

/**
 * Canonical changelog-category icon-type vocabulary.
 *
 * The `changelog_category.icon_type` column is plain text (not a Postgres
 * enum) so new icon types don't require migrations; this Effect Schema is the
 * single source of truth.
 */
export const ChangelogCategoryIconType = S.Literals(["color", "emoji", "icon"]);

export type TChangelogCategoryIconType = S.Schema.Type<
  typeof ChangelogCategoryIconType
>;

/**
 * A `#RRGGBB` / `#RGB` hex color value used for color icon payloads.
 */
export const ChangelogCategoryColorIcon = {
  iconType: S.Literal("color"),
  schema: S.String.pipe(
    S.check(
      S.isPattern(/^#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?$/, {
        message: "must be a valid hex color",
      })
    )
  ),
};

export type TChangelogCategoryColorIcon = S.Schema.Type<
  typeof ChangelogCategoryColorIcon.schema
>;
