import type { THelpCenterTopicWithCount } from "@feeblo/domain/help-center-topic/schema";
import { Button } from "@feeblo/ui/button";
import { ConfirmDialog } from "@feeblo/ui/confirm-dialog";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@feeblo/ui/empty";
import { FloatingActionButton } from "@feeblo/ui/floating-action-button";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
} from "@feeblo/ui/menu";
import { Skeleton } from "@feeblo/ui/skeleton";
import { SkeletonLoader } from "@feeblo/ui/skeleton-loader";
import { toastManager } from "@feeblo/ui/toast";
import { isLiveQueryFailed } from "@feeblo/web-shared/collections";
import { hasPermission, usePolicy } from "@feeblo/web-shared/use-policy";
import {
  ArrowLeft02Icon,
  BookOpen01Icon,
  Delete02Icon,
  Edit02Icon,
  Ellipsis,
  Plus,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { and, eq, useLiveQuery } from "@tanstack/react-db";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { useDashboardCollections } from "~/providers/dashboard-collections-provider";

import { HelpCenterArticleListView } from "./help-center-article-list-view";
import {
  HelpCenterArticleUsage,
  useHelpCenterArticleAllowance,
} from "./help-center-article-usage";
import { EditHelpCenterTopicDialog } from "./help-center-topic-dialog";
import { HelpCenterTopicIcon } from "./help-center-topic-icon";

/**
 * One section: its articles, and the actions that belong to it.
 *
 * The section's own settings live here rather than in the index's rows. That
 * keeps the index a list of places to go, and makes "delete this section" a
 * decision taken while looking at the articles it would take with it.
 */
export function HelpCenterSectionPage({
  organizationId,
  topicId,
}: {
  organizationId: string;
  topicId: string;
}) {
  const collections = useDashboardCollections();

  const { helpCenterTopicCollection } = collections;

  const topicArticles = collections.helpCenterTopicArticleCollection(topicId);

  const navigate = useNavigate();

  const { allowed: canManage } = usePolicy(
    hasPermission(organizationId, "helpCenterArticles.*")
  );

  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletePending, setDeletePending] = useState(false);

  /**
   * The row the delete is removing.
   *
   * The collection drops the row optimistically, so between the click and the
   * server's answer `topics` no longer holds it. Without this the page would
   * flash "Section not found" for the length of one round trip before the
   * navigation it was about to make.
   */
  const [deletingTopic, setDeletingTopic] =
    useState<THelpCenterTopicWithCount | null>(null);

  const topicsQuery = useLiveQuery({
    queryKey: [
      "help-center-topics",
      helpCenterTopicCollection.id,
      organizationId,
    ],
    query: (q) =>
      q
        .from({ topic: helpCenterTopicCollection })
        .where(({ topic }) => eq(topic.organizationId, organizationId))
        .orderBy(({ topic }) => topic.position, "asc")
        .orderBy(({ topic }) => topic.name, "asc"),
  });

  const articlesQuery = useLiveQuery({
    queryKey: [
      "help-center-section-articles",
      topicArticles.id,
      organizationId,
      topicId,
    ],
    query: (q) =>
      q
        .from({ article: topicArticles })
        .where(({ article }) =>
          and(
            eq(article.organizationId, organizationId),
            eq(article.topicId, topicId)
          )
        )
        .orderBy(({ article }) => article.updatedAt, "desc"),
  });

  const topics = topicsQuery.data ?? [];

  const topic =
    topics.find((row) => row.id === topicId) ??
    (deletingTopic?.id === topicId ? deletingTopic : undefined);

  const articles = articlesQuery.data ?? [];

  // The plan counts articles per workspace, so the allowance is the sum of the
  // section counts — a number the index already had to compute for its rows.
  const articleTotal = topics.reduce(
    (total, row) => total + row.articleCount,
    0
  );

  const { atLimit } = useHelpCenterArticleAllowance(articleTotal);

  const confirmDeleteSection = async () => {
    if (topic === undefined) {
      return;
    }

    setDeletePending(true);
    setDeletingTopic(topic);

    try {
      const tx = helpCenterTopicCollection.delete(topic.id);

      // `when("settled")` is the collection's own report that the server
      // accepted the write. The optimistic removal has already happened, so a
      // refusal — a section that gained an article since this page loaded —
      // has to be surfaced rather than swallowed.
      await tx.when("settled");
      setDeleteOpen(false);
      void navigate({
        params: { organizationId },
        to: "/$organizationId/help-center",
      });
    } catch {
      setDeletingTopic(null);
      toastManager.add({
        title: "Failed to delete the section",
        type: "error",
      });
    } finally {
      setDeletePending(false);
    }
  };

  if (isLiveQueryFailed(topicsQuery) || isLiveQueryFailed(articlesQuery)) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>Help center unavailable</EmptyTitle>
          <EmptyDescription>
            There was a problem loading this section.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  if (topicsQuery.isLoading) {
    return (
      <div className="mx-auto w-full space-y-3 p-3">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (topic === undefined) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>Section not found</EmptyTitle>
          <EmptyDescription>
            We could not find the section you requested.
          </EmptyDescription>
          <EmptyContent>
            <Button
              render={(props) => (
                <Link
                  {...props}
                  params={{ organizationId }}
                  to="/$organizationId/help-center"
                >
                  Back to help center
                </Link>
              )}
              variant="link"
            />
          </EmptyContent>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="mx-auto w-full">
      <header className="flex flex-wrap items-start gap-3 p-3">
        <Button
          aria-label="Back to help center"
          render={(props) => (
            <Link
              {...props}
              params={{ organizationId }}
              to="/$organizationId/help-center"
            />
          )}
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          <HugeiconsIcon icon={ArrowLeft02Icon} />
        </Button>

        <span className="bg-muted text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-md">
          <HelpCenterTopicIcon className="size-4.5" icon={topic.icon} />
        </span>

        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-semibold tracking-tight">
            {topic.name}
          </h1>
          <p className="text-muted-foreground truncate text-sm">
            {topic.description ?? `/help/${topic.slug}`}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <HelpCenterArticleUsage used={articleTotal} />
          {canManage ? (
            <>
              {atLimit ? (
                <Button
                  className="max-md:hidden"
                  disabled
                  type="button"
                  variant="brand"
                >
                  <HugeiconsIcon icon={Plus} />
                  New article
                </Button>
              ) : (
                <Button
                  className="max-md:hidden"
                  render={(props) => (
                    <Link
                      {...props}
                      params={{ organizationId, topicId }}
                      to="/$organizationId/help-center/$topicId/new"
                    />
                  )}
                  type="button"
                  variant="brand"
                >
                  <HugeiconsIcon icon={Plus} />
                  New article
                </Button>
              )}
              <FloatingActionButton
                disabled={atLimit}
                icon={<HugeiconsIcon icon={Plus} />}
                onClick={() =>
                  void navigate({
                    params: { organizationId, topicId },
                    to: "/$organizationId/help-center/$topicId/new",
                  })
                }
              >
                New article
              </FloatingActionButton>
              <Menu>
                <MenuTrigger
                  render={
                    <Button
                      aria-label={`Actions for ${topic.name}`}
                      size="icon-sm"
                      type="button"
                      variant="outline"
                    />
                  }
                >
                  <HugeiconsIcon icon={Ellipsis} />
                </MenuTrigger>
                <MenuPopup align="end">
                  <MenuItem onClick={() => setEditOpen(true)}>
                    <HugeiconsIcon icon={Edit02Icon} />
                    Edit section
                  </MenuItem>
                  <MenuSeparator />
                  <MenuItem
                    disabled={topic.articleCount > 0}
                    onClick={() => setDeleteOpen(true)}
                    variant="destructive"
                  >
                    <HugeiconsIcon icon={Delete02Icon} />
                    Delete section
                  </MenuItem>
                </MenuPopup>
              </Menu>
            </>
          ) : null}
        </div>
      </header>

      <SkeletonLoader isLoading={articlesQuery.isLoading}>
        {!articlesQuery.isLoading && articles.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <HugeiconsIcon icon={BookOpen01Icon} />
              </EmptyMedia>
              <EmptyTitle>No articles yet</EmptyTitle>
              <EmptyDescription>
                Write the first page readers will find in this section.
              </EmptyDescription>
            </EmptyHeader>
            {canManage ? (
              <EmptyContent>
                {atLimit ? (
                  <p className="text-muted-foreground text-sm">
                    This workspace has reached its plan's article limit.
                  </p>
                ) : (
                  <Button
                    render={(props) => (
                      <Link
                        {...props}
                        params={{ organizationId, topicId }}
                        to="/$organizationId/help-center/$topicId/new"
                      >
                        Create the first article
                      </Link>
                    )}
                    type="button"
                  />
                )}
              </EmptyContent>
            ) : null}
          </Empty>
        ) : (
          <HelpCenterArticleListView
            articles={articles}
            organizationId={organizationId}
          />
        )}
      </SkeletonLoader>

      <EditHelpCenterTopicDialog
        // Keyed by the row, so the form mounts fresh with that row's values
        // instead of an effect resetting the previous one.
        key={topic.id}
        onOpenChange={setEditOpen}
        open={editOpen}
        topic={topic}
      />
      <ConfirmDialog
        confirmLabel="Delete section"
        confirmLoading={deletePending}
        description="The section disappears from the help center. Sections that still hold articles cannot be deleted."
        onConfirm={confirmDeleteSection}
        onOpenChange={setDeleteOpen}
        open={deleteOpen}
        title={`Delete ${topic.name}?`}
      />
    </div>
  );
}
