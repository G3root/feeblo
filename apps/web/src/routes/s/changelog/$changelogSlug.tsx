import {
  preloadChangelogDetail,
  type PreloadOutcome,
} from "@feeblo/public-feature-board";
import { ChangelogDetailPage } from "@feeblo/public-feature-board/pages/changelog-detail";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/s/changelog/$changelogSlug")({
  // The single-entry body (with its linked posts) replaces a full-list
  // preload: one response instead of up to `PUBLIC_CHANGELOG_LIMIT` bodies.
  // The page's other reads — category badges and category links — come from
  // the collections `preloadChangelogDetail` seeds; the changelog list itself
  // belongs to the index route (`/s/changelog/`), which preloads it for its
  // own page, so the detail route must not fetch it per visit.
  beforeLoad: async ({
    context,
    params,
  }): Promise<PreloadOutcome | undefined> => {
    if (context.boardPage.kind !== "found") {
      // The layout renders its unavailable state; preloading anything would
      // only hold the response open.
      return undefined;
    }

    return preloadChangelogDetail(context.dbClient, {
      organizationId: context.boardPage.site.organizationId,
      slug: params.changelogSlug,
    });
  },
  component: ChangelogDetailRoute,
});

function ChangelogDetailRoute() {
  const { changelogSlug } = Route.useParams();

  return <ChangelogDetailPage changelogSlug={changelogSlug} />;
}
