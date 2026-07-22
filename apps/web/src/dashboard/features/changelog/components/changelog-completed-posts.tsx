import { Checkbox } from "@feeblo/ui/checkbox";
import { toastManager } from "@feeblo/ui/toast";
import {
  and,
  eq,
  isNull,
  isUndefined,
  or,
  useLiveQuery,
} from "@tanstack/react-db";
import { getChangelogPostKey } from "~/lib/collections";
import { useDashboardCollections } from "~/providers/dashboard-collections-provider";
import { useChangelogEditorContext } from "./changelog-editor";

export function ChangelogCompletedPosts({
  organizationId,
}: {
  organizationId: string;
}) {
  const { changelogPostCollection, postCollection, postStatusCollection } =
    useDashboardCollections();
  const { changelog, isOwner } = useChangelogEditorContext();
  const completedPostsQuery = useLiveQuery(
    (q) =>
      q
        .from({ post: postCollection })
        .innerJoin({ status: postStatusCollection }, ({ post, status }) =>
          eq(post.statusId, status.id)
        )
        .leftJoin(
          { assignment: changelogPostCollection },
          ({ post, assignment }) => eq(post.id, assignment.postId)
        )
        .where(({ assignment, post, status }) =>
          and(
            eq(post.organizationId, organizationId),
            eq(status.type, "COMPLETED"),
            or(
              isNull(assignment.postId),
              isUndefined(assignment.postId),
              eq(assignment.changelogId, changelog.id)
            )
          )
        )
        .orderBy(({ post }) => post.updatedAt, "desc")
        .select(({ assignment, post }) => ({
          assignmentChangelogId: assignment.changelogId,
          id: post.id,
          title: post.title,
        })),
    [changelog.id, organizationId]
  );
  const completedPosts = completedPostsQuery.data ?? [];

  const updateAssignment = async ({
    checked,
    postId,
  }: {
    checked: boolean;
    postId: string;
  }) => {
    try {
      const tx = checked
        ? changelogPostCollection.insert({
            changelogId: changelog.id,
            postId,
            organizationId,
            createdAt: new Date(),
          })
        : changelogPostCollection.delete(
            getChangelogPostKey({ changelogId: changelog.id, postId })
          );
      await tx.isPersisted.promise;
    } catch (_error) {
      toastManager.add({
        title: "Failed to update completed posts",
        type: "error",
      });
    }
  };

  return (
    <section aria-labelledby="recently-completed-heading" className="space-y-3">
      <div className="space-y-1">
        <h2 className="font-medium text-sm" id="recently-completed-heading">
          Recently completed
        </h2>
        <p className="text-muted-foreground text-sm">
          Pick shipped work to include in this update.
        </p>
      </div>

      {completedPosts.length > 0 ? (
        <div className="divide-y rounded-xl border">
          {completedPosts.map((post) => (
            <div
              className="flex items-center gap-3 px-4 py-3 text-sm"
              key={post.id}
            >
              <Checkbox
                aria-label={post.title}
                checked={post.assignmentChangelogId === changelog.id}
                disabled={!isOwner}
                onCheckedChange={(checked) =>
                  updateAssignment({ checked, postId: post.id })
                }
              />
              <span className="min-w-0 truncate">{post.title}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="rounded-xl border border-dashed px-4 py-5 text-muted-foreground text-sm">
          Completed posts that have not appeared in a changelog will show here.
        </p>
      )}
    </section>
  );
}
