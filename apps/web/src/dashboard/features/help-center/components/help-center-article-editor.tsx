import { targetStatesFor } from "@feeblo/domain/help-center-article/machine";
import { HelpCenterArticleId } from "@feeblo/id";
import { Button } from "@feeblo/ui/button";
import { Field, FieldDescription, FieldLabel } from "@feeblo/ui/field";
import { Input } from "@feeblo/ui/input";
import { MarkdownContent } from "@feeblo/ui/markdown-content";
import { Tabs, TabsList, TabsPanel, TabsTab } from "@feeblo/ui/tabs";
import { Textarea } from "@feeblo/ui/textarea";
import { cn } from "@feeblo/ui/utils";
import { ArrowLeft02Icon, Delete02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { eq, useLiveQuery } from "@tanstack/react-db";
import { Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import { fetchRpc } from "~/lib/runtime";
import { useDashboardCollections } from "~/providers/dashboard-collections-provider";

import { HelpCenterTopicIcon } from "./help-center-topic-icons";

type ArticleStatus = "draft" | "published" | "archived";

const STATUS_LABELS = {
  archived: "Archived",
  draft: "Draft",
  published: "Published",
} as const satisfies Record<ArticleStatus, string>;

/**
 * The article editor.
 *
 * The body is Markdown and the field says so: it is what the column stores, what
 * "copy as Markdown" copies, and what a future file sync round-trips. A rich
 * text editor would have to serialise back to Markdown on every keystroke to
 * keep that promise, which is a separate decision and a separate slice.
 *
 * One component serves create and edit. `article` being absent is the create.
 */
export function HelpCenterArticleEditor({
  article,
  defaultTopicId,
  organizationId,
}: {
  article?: {
    content: string;
    id: string;
    position: number | null;
    publishedAt: Date | null;
    slug: string;
    status: string;
    title: string;
    topicId: string;
  };
  defaultTopicId?: string | undefined;
  organizationId: string;
}) {
  const { helpCenterArticleCollection, helpCenterTopicCollection } =
    useDashboardCollections();

  const navigate = useNavigate();

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

  const topics = topicsQuery.data ?? [];

  const [title, setTitle] = useState(article?.title ?? "");
  const [slug, setSlug] = useState(article?.slug ?? "");
  const [content, setContent] = useState(article?.content ?? "");

  const [topicId, setTopicId] = useState(
    article?.topicId ?? defaultTopicId ?? ""
  );

  const [status, setStatus] = useState<ArticleStatus>(
    isArticleStatus(article?.status) ? article.status : "draft"
  );

  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const preview = useMemo(() => content, [content]);

  /**
   * The statuses the lifecycle permits from where this article is now.
   *
   * Derived from the domain machine rather than listed here, so the editor
   * cannot offer a move the graph says is unreachable — `draft → archived` is
   * one, because a page nobody has published is deleted rather than withdrawn.
   * The server asks the same machine, so this is the picker agreeing with the
   * write instead of a second opinion.
   */
  const offeredStatuses = useMemo(() => {
    const current: ArticleStatus = isArticleStatus(article?.status)
      ? article.status
      : "draft";

    return [current, ...targetStatesFor(current)].filter(isArticleStatus);
  }, [article?.status]);

  const save = async () => {
    const trimmedTitle = title.trim();

    if (trimmedTitle.length === 0) {
      setError("An article needs a title.");

      return;
    }

    if (topicId.length === 0) {
      setError("Choose a section for this article.");

      return;
    }

    setPending(true);
    setError(null);

    try {
      if (article === undefined) {
        const id = await HelpCenterArticleId.unsafeGenerate();
        await fetchRpc((rpc) =>
          rpc.CreateHelpCenterArticle({
            id,
            organizationId,
            topicId,
            title: trimmedTitle,
            // Omitted rather than sent as "": the server derives the slug from
            // the title, and an empty string is refused rather than treated as
            // "no preference".
            slug: slug.trim().length === 0 ? undefined : slug.trim(),
            content,
            status,
            publishedAt: status === "draft" ? null : new Date(),
            position: null,
          })
        );
        await helpCenterArticleCollection.utils.refetch();

        await navigate({
          params: { organizationId },
          to: "/$organizationId/help-center",
        });

        return;
      }

      await fetchRpc((rpc) =>
        rpc.UpdateHelpCenterArticle({
          id: article.id,
          organizationId,
          topicId,
          title: trimmedTitle,
          slug: slug.trim().length === 0 ? article.slug : slug.trim(),
          content,
          status,
          // A flip back to draft clears the date; the server applies the same
          // rule, and sending the previous date for a non-draft status is what
          // keeps a typo fix from looking like a new release.
          publishedAt: status === "draft" ? null : article.publishedAt,
          position: article.position,
        })
      );
      await helpCenterArticleCollection.utils.refetch();

      await navigate({
        params: { organizationId },
        to: "/$organizationId/help-center",
      });
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not save the article."
      );
    } finally {
      setPending(false);
    }
  };

  const remove = async () => {
    if (article === undefined) {
      return;
    }

    setPending(true);

    try {
      helpCenterArticleCollection.delete(article.id);
      await navigate({
        params: { organizationId },
        to: "/$organizationId/help-center",
      });
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <header className="flex items-center justify-between gap-3">
        <Button
          render={
            <Link
              params={{ organizationId }}
              to="/$organizationId/help-center"
            />
          }
          size="sm"
          type="button"
          variant="ghost"
        >
          <HugeiconsIcon icon={ArrowLeft02Icon} />
          Help center
        </Button>

        <div className="flex items-center gap-2">
          {article === undefined ? null : (
            <Button
              disabled={pending}
              onClick={remove}
              type="button"
              variant="ghost"
            >
              <HugeiconsIcon icon={Delete02Icon} />
              Delete
            </Button>
          )}
          <Button disabled={pending} onClick={save} type="button">
            {article === undefined ? "Create article" : "Save changes"}
          </Button>
        </div>
      </header>

      <Field>
        <FieldLabel htmlFor="help-center-article-title">Title</FieldLabel>
        <Input
          id="help-center-article-title"
          maxLength={200}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="How do I reset my password?"
          value={title}
        />
      </Field>

      <Field>
        <FieldLabel htmlFor="help-center-article-slug">URL slug</FieldLabel>
        <Input
          id="help-center-article-slug"
          maxLength={200}
          onChange={(event) => setSlug(event.target.value)}
          placeholder="reset-my-password"
          value={slug}
        />
        <FieldDescription>
          Leave empty to derive it from the title.
        </FieldDescription>
      </Field>

      <Field>
        <FieldLabel>Section</FieldLabel>
        <div className="flex flex-wrap gap-2">
          {topics.map((topic) => (
            <button
              aria-pressed={topicId === topic.id}
              className={cn(
                "inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm transition-colors",
                topicId === topic.id
                  ? "border-primary/50 bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
              key={topic.id}
              onClick={() => setTopicId(topic.id)}
              type="button"
            >
              <HelpCenterTopicIcon className="size-4" icon={topic.icon} />
              {topic.name}
            </button>
          ))}
        </div>
        {topics.length === 0 ? (
          <FieldDescription>
            Create a section first — every article belongs to one.
          </FieldDescription>
        ) : null}
      </Field>

      <Field>
        <FieldLabel>Status</FieldLabel>
        <div className="flex flex-wrap gap-2">
          {offeredStatuses.map((option) => (
            <button
              aria-pressed={status === option}
              className={cn(
                "rounded-md border px-3 py-1.5 text-sm transition-colors",
                status === option
                  ? "border-primary/50 bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
              key={option}
              onClick={() => setStatus(option)}
              type="button"
            >
              {STATUS_LABELS[option]}
            </button>
          ))}
        </div>
        <FieldDescription>
          Archived articles stay reachable so old links do not break, but the
          portal marks them as out of date. Only the moves the article's
          lifecycle allows are offered.
        </FieldDescription>
      </Field>

      <Tabs defaultValue="write">
        <TabsList>
          <TabsTab value="write">Write</TabsTab>
          <TabsTab value="preview">Preview</TabsTab>
        </TabsList>
        <TabsPanel value="write">
          <Textarea
            className="min-h-[28rem] font-mono text-sm"
            onChange={(event) => setContent(event.target.value)}
            placeholder={"# Getting started\n\nWrite in Markdown."}
            value={content}
          />
        </TabsPanel>
        <TabsPanel value="preview">
          <div className="bg-card min-h-[28rem] rounded-lg border p-6">
            {preview.trim().length === 0 ? (
              <p className="text-muted-foreground text-sm">
                Nothing to preview.
              </p>
            ) : (
              <MarkdownContent content={preview} />
            )}
          </div>
        </TabsPanel>
      </Tabs>

      {error === null ? null : (
        <p className="text-destructive text-sm">{error}</p>
      )}
    </div>
  );
}

const isArticleStatus = (value: string | undefined): value is ArticleStatus =>
  value === "draft" || value === "published" || value === "archived";
