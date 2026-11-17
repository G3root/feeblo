import type { THelpCenterArticleState } from "@feeblo/domain-contracts/help-center-article";
import { targetStatesFor } from "@feeblo/domain/help-center-article/machine";
import { HelpCenterArticleId } from "@feeblo/id";
import { Button } from "@feeblo/ui/button";
import { FieldDescription, FieldLabel } from "@feeblo/ui/field";
import { useAppForm } from "@feeblo/ui/hooks/form";
import { MarkdownContent } from "@feeblo/ui/markdown-content";
import { Tabs, TabsList, TabsPanel, TabsTab } from "@feeblo/ui/tabs";
import { cn } from "@feeblo/ui/utils";
import { fetchRpc } from "@feeblo/web-shared/runtime";
import { ArrowLeft02Icon, Delete02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { eq, useLiveQuery } from "@tanstack/react-db";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";

import { useDashboardCollections } from "~/providers/dashboard-collections-provider";

import {
  helpCenterArticleFormOptions,
  helpCenterArticleFormValues,
} from "../help-center-forms";
import { HelpCenterTopicIcon } from "./help-center-topic-icons";

/**
 * What the editor is editing, as a discriminated union rather than an optional
 * row.
 *
 * `article?: {...}` made "create" mean "the prop is absent", so the body
 * branched on `article === undefined` five times and the delete button's
 * presence was a truthiness test. The two modes now say which one they are, and
 * a caller cannot read a row without having one.
 */
export type HelpCenterArticleEditorProps =
  | { readonly mode: "create"; readonly organizationId: string }
  | {
      readonly article: {
        readonly content: string;
        readonly id: string;
        readonly position: number | null;
        readonly publishedAt: Date | null;
        readonly slug: string;
        readonly status: THelpCenterArticleState;
        readonly title: string;
        readonly topicId: string;
      };
      readonly mode: "edit";
      readonly organizationId: string;
    };

const ARTICLE_FORM_ID = "help-center-article-form";

const STATUS_LABELS = {
  archived: "Archived",
  draft: "Draft",
  published: "Published",
} satisfies Record<THelpCenterArticleState, string>;

/**
 * The article editor.
 *
 * The body is Markdown and the field says so: it is what the column stores,
 * what "copy as Markdown" copies, and what a future file sync round-trips.
 *
 * The form is TanStack Form's, which is what removed this component's
 * `useState` pile: six values, a hand-rolled empty check, and a `pending` flag
 * that raced the error message. Validation lives in `help-center-forms.ts` next
 * to the server's bounds, and a rejected write reaches the form's own submit
 * error rather than a local string.
 */
export function HelpCenterArticleEditor(props: HelpCenterArticleEditorProps) {
  const { organizationId } = props;

  const { helpCenterArticleCollection, helpCenterTopicCollection } =
    useDashboardCollections();

  const navigate = useNavigate();
  const queryClient = useQueryClient();

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

  const article = props.mode === "edit" ? props.article : undefined;

  /**
   * The statuses the lifecycle permits from where this article is now.
   *
   * Derived from the domain machine rather than listed, so the editor cannot
   * offer a move the graph says is unreachable — `draft → archived` is one,
   * because a page nobody has published is deleted rather than withdrawn. The
   * server asks the same machine, so this is the picker agreeing with the write
   * instead of a second opinion.
   */
  const currentStatus: THelpCenterArticleState = article?.status ?? "draft";
  const offeredStatuses = [currentStatus, ...targetStatesFor(currentStatus)];

  const form = useAppForm({
    ...helpCenterArticleFormOptions,
    defaultValues: helpCenterArticleFormValues(article),
    onSubmit: async ({ value }) => {
      const topicId = value.topicId;
      const title = value.title.trim();
      const slug = value.slug.trim();

      /**
       * Drop the route's cached single-article read.
       *
       * The editor page holds the body under `["help-center-article", org, id]`.
       * After this form replaces or removes that article, invalidating would
       * leave the entry *readable*, so reopening would paint the old body
       * until a refetch landed; removing it makes the next open a load.
       */
      const forgetArticle = () => {
        if (article === undefined) {
          return;
        }

        queryClient.removeQueries({
          queryKey: ["help-center-article", organizationId, article.id],
        });
      };

      if (article === undefined) {
        const id = await HelpCenterArticleId.unsafeGenerate();

        await fetchRpc((rpc) =>
          rpc.CreateHelpCenterArticle({
            id,
            organizationId,
            topicId,
            title,
            // Omitted rather than sent as "": the server derives the slug from
            // the title, and an empty string is refused rather than treated as
            // "no preference".
            slug: slug.length === 0 ? undefined : slug,
            content: value.content,
            status: value.status,
            publishedAt: value.status === "draft" ? null : new Date(),
            position: null,
          })
        );
      } else {
        await fetchRpc((rpc) =>
          rpc.UpdateHelpCenterArticle({
            id: article.id,
            organizationId,
            topicId,
            title,
            slug: slug.length === 0 ? article.slug : slug,
            content: value.content,
            status: value.status,
            // A flip back to draft clears the date; the server applies the same
            // rule, and sending the previous date for a non-draft status is what
            // keeps a typo fix from looking like a new release.
            publishedAt: value.status === "draft" ? null : article.publishedAt,
            position: article.position,
          })
        );
      }

      await helpCenterArticleCollection.utils.refetch();
      forgetArticle();
      await navigate({
        params: { organizationId },
        to: "/$organizationId/help-center",
      });
    },
  });

  const remove = async () => {
    if (article === undefined) {
      return;
    }

    try {
      const tx = helpCenterArticleCollection.delete(article.id);

      // The collection removes the row optimistically and applies the server's
      // answer through the transaction; awaiting it is what lets a refusal keep
      // the editor open instead of navigating away from a live article.
      await tx.when("settled");

      queryClient.removeQueries({
        queryKey: ["help-center-article", organizationId, article.id],
      });
      await navigate({
        params: { organizationId },
        to: "/$organizationId/help-center",
      });
    } catch (cause) {
      // Rethrown into the form so one place shows every failure, whether it
      // came from the save or the delete.
      throw new Error(
        cause instanceof Error
          ? cause.message
          : "Could not delete the article.",
        { cause }
      );
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
          {props.mode === "create" ? null : (
            <Button onClick={() => void remove()} type="button" variant="ghost">
              <HugeiconsIcon icon={Delete02Icon} />
              Delete
            </Button>
          )}
          <form.SubscribeButton
            // The header is outside the `<form>`, so the button is associated
            // by id rather than by nesting.
            form={ARTICLE_FORM_ID}
            label={props.mode === "create" ? "Create article" : "Save changes"}
            variant="default"
          />
        </div>
      </header>

      <form
        className="contents"
        id={ARTICLE_FORM_ID}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          event.stopPropagation();
          void form.handleSubmit();
        }}
      >
        <div className="space-y-5">
          <form.AppField name="title">
            {(field) => (
              <field.TextField
                label="Title"
                maxLength={200}
                placeholder="How do I reset my password?"
              />
            )}
          </form.AppField>

          <form.AppField name="slug">
            {(field) => {
              const { TextField } = field;

              return (
                <>
                  <TextField
                    label="URL slug"
                    maxLength={200}
                    placeholder="reset-my-password"
                  />
                  <FieldDescription>
                    Leave empty to derive it from the title.
                  </FieldDescription>
                </>
              );
            }}
          </form.AppField>

          <form.AppField name="topicId">
            {(field) => (
              <fieldset className="flex flex-col gap-2">
                <legend className="text-sm font-medium">Section</legend>
                <div className="flex flex-wrap gap-2">
                  {topics.map((topic) => (
                    <button
                      aria-pressed={field.state.value === topic.id}
                      className={cn(
                        "inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm transition-colors",
                        field.state.value === topic.id
                          ? "border-primary/50 bg-primary/10 text-primary"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground"
                      )}
                      key={topic.id}
                      onClick={() => field.handleChange(topic.id)}
                      type="button"
                    >
                      <HelpCenterTopicIcon
                        className="size-4"
                        icon={topic.icon}
                      />
                      {topic.name}
                    </button>
                  ))}
                </div>
                {topics.length === 0 ? (
                  <FieldDescription>
                    Create a section first — every article belongs to one.
                  </FieldDescription>
                ) : null}
              </fieldset>
            )}
          </form.AppField>

          <form.AppField name="status">
            {(field) => (
              <fieldset className="flex flex-col gap-2">
                <legend className="text-sm font-medium">Status</legend>
                <div className="flex flex-wrap gap-2">
                  {offeredStatuses.map((option) => (
                    <button
                      aria-pressed={field.state.value === option}
                      className={cn(
                        "rounded-md border px-3 py-1.5 text-sm transition-colors",
                        field.state.value === option
                          ? "border-primary/50 bg-primary/10 text-primary"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground"
                      )}
                      key={option}
                      onClick={() => field.handleChange(option)}
                      type="button"
                    >
                      {STATUS_LABELS[option]}
                    </button>
                  ))}
                </div>
                <FieldDescription>
                  Archived articles stay reachable so old links do not break,
                  but the portal marks them as out of date. Only the moves the
                  article&apos;s lifecycle allows are offered.
                </FieldDescription>
              </fieldset>
            )}
          </form.AppField>
        </div>

        <Tabs className="mt-6" defaultValue="write">
          <TabsList>
            <TabsTab value="write">Write</TabsTab>
            <TabsTab value="preview">Preview</TabsTab>
          </TabsList>
          <TabsPanel value="write">
            <form.AppField name="content">
              {(field) => (
                <field.TextareaField
                  className="min-h-[28rem] font-mono text-sm"
                  hideLabel
                  label="Article body"
                  placeholder={"# Getting started\n\nWrite in Markdown."}
                />
              )}
            </form.AppField>
          </TabsPanel>
          <TabsPanel value="preview">
            <div className="bg-card min-h-[28rem] rounded-lg border p-6">
              <form.Subscribe selector={(state) => state.values.content}>
                {(content) =>
                  content.trim().length === 0 ? (
                    <p className="text-muted-foreground text-sm">
                      Nothing to preview.
                    </p>
                  ) : (
                    <MarkdownContent content={content} />
                  )
                }
              </form.Subscribe>
            </div>
          </TabsPanel>
        </Tabs>

        <form.Subscribe selector={(state) => state.errorMap.onSubmit}>
          {(error) =>
            error === undefined || error === null ? null : (
              <p className="text-destructive mt-4 text-sm">{String(error)}</p>
            )
          }
        </form.Subscribe>
      </form>
    </div>
  );
}
