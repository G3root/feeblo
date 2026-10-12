import { isLiveQueryPending } from "@feeblo/web-shared/collections";
import { and, eq, useLiveQuery } from "@tanstack/react-db";

import { usePostCollectionData } from "./post-page-context";
import { usePostCollections } from "./providers/post-collections-provider";

/**
 * Resolves the full post body through the slug-scoped detail collection.
 *
 * List rows (`PostListItem`) carry no `content` — cards and boards only need
 * the excerpt — so detail views resolve the body separately. Detail routes
 * preload the same cache entry in `beforeLoad`, so this subscription usually
 * hits cache and never blocks the surrounding shell: title, reactions, and
 * comments render from the list row while the body streams in.
 */
export function usePostDetail() {
  const { post } = usePostCollectionData();
  const {
    collections: { postDetailCollection },
    organizationId,
  } = usePostCollections();

  const query = useLiveQuery({
    // Used by every post detail view; the explicit key skips rebuilding the
    // slug-scoped lookup on re-renders.
    queryKey: [
      "post-detail",
      postDetailCollection.id,
      organizationId,
      post.slug,
    ],
    query: (q) =>
      q
        .from({ detail: postDetailCollection })
        .where(({ detail }) =>
          and(
            eq(detail.organizationId, organizationId),
            eq(detail.slug, post.slug)
          )
        )
        .findOne(),
  });

  return {
    assetIds: query.data?.assetIds,
    content: query.data?.content,
    isError: query.isError,
    // Hydration lands the detail row before the first client render, so
    // `isLoading` would flash the body skeleton over server-rendered content.
    isLoading: isLiveQueryPending(query),
  };
}
