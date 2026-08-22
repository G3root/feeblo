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
 * An `oklch()` color value used for color icon payloads.
 */
export const ChangelogCategoryColorIcon = {
  iconType: S.Literal("color"),
  schema: S.String.pipe(
    S.check(
      S.isPattern(
        /^oklch\(\d+(?:\.\d+)?%?\s+\d+(?:\.\d+)?%?\s+\d+(?:\.\d+)?(?:deg)?\)$/,
        {
          message: "must be a valid oklch color",
        }
      )
    )
  ),
};

export type TChangelogCategoryColorIcon = S.Schema.Type<
  typeof ChangelogCategoryColorIcon.schema
>;
