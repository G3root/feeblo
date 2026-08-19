import { useAuthState } from "@feeblo/web-shared/use-auth-state";
import { and, eq, useLiveQuery } from "@tanstack/react-db";

import { usePostCollectionData } from "../post-page-context";
import { usePostCollections } from "../providers/post-collections-provider";
import { CommentDisplayItem } from "./list-item";

export function CommentsList() {
  const { data: session } = useAuthState();
  const { organizationId, post, isMember } = usePostCollectionData();
  const {
    collections: { commentCollection },
  } = usePostCollections();
  const postSlug = post.slug;

  const { data: comments, isLoading: isCommentsLoading } = useLiveQuery(
    (q) =>
      q
        .from({ comment: commentCollection })
        .where(({ comment }) =>
          and(
            eq(comment.organizationId, organizationId),
            eq(comment.postSlug, postSlug),
            ...(isMember ? [] : [eq(comment.visibility, "PUBLIC")])
          )
        )
        .orderBy((comment) => comment.comment.createdAt, "desc"),
    [organizationId, postSlug, isMember]
  );

  if (isCommentsLoading) {
    return null;
  }

  return comments.map((data) => (
    <CommentDisplayItem
      currentUserId={session?.user?.id}
      data={data}
      key={data.id}
    />
  ));
}
