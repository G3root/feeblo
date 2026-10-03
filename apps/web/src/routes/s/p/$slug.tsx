import {
  preloadPostDetail,
  preloadPostUserState,
  type PreloadOutcome,
} from "@feeblo/public-feature-board";
import { PublicBoardPending } from "@feeblo/public-feature-board/components/pending";
import { PostPage } from "@feeblo/public-feature-board/pages/post";
import { getCachedAuthSession } from "@feeblo/web-shared/auth-session";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/s/p/$slug")({
  // The post detail body is client-rendered, exactly as it was before this
  // route moved onto the host router. Its data lives in `syncMode: "on-demand"`
  // collections whose loaded subsets are not part of the dehydrated state
  // (a live-query snapshot is keyed by query identity, and the page's subsets
  // are user- and membership-dependent), so a server render would produce
  // markup the browser cannot reproduce on its first render — a hydration
  // mismatch, not just a flash. Server-rendering it needs subsets that
  // hydrate by identity; until then the layout above still resolves the site,
  // the post's metadata and its JSON-LD for crawlers.
  //
  // The pending state must be the board's own: with nothing set here, the
  // router falls back to the dashboard's skeleton — and for an ssr:false
  // route that skeleton is what the server renders into the board shell and
  // what the visitor stares at while the client route load runs.
  pendingComponent: PublicBoardPending,
  ssr: false,
  beforeLoad: async ({
    context,
    params,
  }): Promise<PreloadOutcome | undefined> => {
    if (context.boardPage.kind !== "found") {
      return undefined;
    }

    const { organizationId } = context.boardPage.site;
    const outcome = await preloadPostDetail(context.dbClient, {
      organizationId,
      slug: params.slug,
    });

    // Subscription and delete hints are per-user private state: skip the RPC
    // for anonymous visitors. The page's own subscriptions load them if a
    // session resolves after hydration.
    if (getCachedAuthSession()) {
      const userState = await preloadPostUserState(context.dbClient, {
        organizationId,
      });

      return { degraded: outcome.degraded || userState.degraded };
    }

    return outcome;
  },
  component: PostRoute,
});

function PostRoute() {
  const { slug } = Route.useParams();

  return <PostPage slug={slug} />;
}
