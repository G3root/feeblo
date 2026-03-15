import { and, eq, useLiveQuery } from "@tanstack/react-db";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemTitle,
} from "~/components/ui/item";
import { authClient } from "~/lib/auth-client";
import { publicCommentCollection } from "../../lib/collections";
import { useSite } from "../../providers/site-provider";
import { AuthDialog } from "../common/auth-dialog";

export function CommentsSection({ postId }: { postId: string }) {
  const site = useSite();
  const { data: session } = authClient.useSession();
  const commentsQuery = useLiveQuery(
    (q) =>
      q
        .from({ comment: publicCommentCollection })
        .where(({ comment }) =>
          and(
            eq(comment.organizationId, site.organizationId),
            eq(comment.postId, postId)
          )
        ),
    [postId, site.organizationId]
  );
  const canComment = Boolean(session?.user?.id && session.user.name);
  const currentUserName = session?.user?.name ?? null;

  const comments = commentsQuery.data ?? [];

  if (commentsQuery.isLoading) {
    return <p className="text-muted-foreground text-sm">Loading comments...</p>;
  }

  if (commentsQuery.isError) {
    return (
      <Card className="ring-1 ring-border/60">
        <CardHeader>
          <CardTitle>Comments unavailable</CardTitle>
        </CardHeader>
        <CardContent className="text-muted-foreground text-sm">
          There was a problem loading comments for this post.
        </CardContent>
      </Card>
    );
  }

  console.log({ comments });

  return (
    <section className="space-y-4">
      <NonAuthenticatedCommentsSection />
    </section>
  );
}

function NonAuthenticatedCommentsSection() {
  const { data: session } = authClient.useSession();
  if (session) {
    return null;
  }

  return (
    <Item variant="outline">
      <ItemContent>
        <ItemTitle>Join the discussion</ItemTitle>
        <ItemDescription>
          Sign in to leave join the conversation.
        </ItemDescription>
      </ItemContent>
      <ItemActions>
        <AuthDialog variant="sign-in" />
      </ItemActions>
    </Item>
  );
}
