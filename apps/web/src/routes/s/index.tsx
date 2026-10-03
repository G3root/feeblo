import { BoardHomePage } from "@feeblo/public-feature-board/pages/home";
import { createFileRoute } from "@tanstack/react-router";
import * as S from "effect/Schema";

/**
 * The board's home page.
 *
 * Its filters live in the URL, so the search schema belongs to this route (the
 * page component reads the validated values through the router).
 */
const HomeSearchSchema = S.toStandardSchemaV1(
  S.Struct({
    board: S.String.pipe(S.optional),
    sort: S.String.pipe(S.optional),
    status: S.String.pipe(S.optional),
  })
);

export const Route = createFileRoute("/s/")({
  validateSearch: HomeSearchSchema,
  component: BoardHomePage,
});
