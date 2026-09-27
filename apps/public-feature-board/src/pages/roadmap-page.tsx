import { PublicRoadmapPage } from "../components/roadmap/public-roadmap-page";

/**
 * The board's roadmap.
 *
 * `slug` selects a single roadmap lane; the host route passes it as a prop
 * instead of the page reading route params, so the page has no opinion about
 * the host's route tree.
 */
export function BoardRoadmapPage({ slug }: { readonly slug?: string }) {
  return <PublicRoadmapPage slug={slug} />;
}
