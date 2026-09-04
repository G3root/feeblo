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

  const query = useLiveQuery(
    (q) =>
      q
        .from({ detail: postDetailCollection })
        .where(({ detail }) =>
          and(
            eq(detail.organizationId, organizationId),
            eq(detail.slug, post.slug)
          )
        )
        .findOne(),
    [organizationId, post.slug]
  );

  return {
    assetIds: query.data?.assetIds,
    content: query.data?.content,
    isError: query.isError,
    isLoading: query.isLoading,
  };
}
