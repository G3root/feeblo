import { useAtomSet } from "@effect/atom-react";
import type {
  THelpCenterArticleState,
  THelpCenterArticleWriteState,
} from "@feeblo/domain-contracts/help-center-article";
import { HelpCenterArticleId } from "@feeblo/id";
import { PostContentEditor } from "@feeblo/post-ui/post-content";
import { Button } from "@feeblo/ui/button";
import { finalizeEditorContent } from "@feeblo/ui/editor";
import { useAppForm } from "@feeblo/ui/hooks/form";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "@feeblo/ui/menu";
import { toastManager } from "@feeblo/ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@feeblo/ui/tooltip";
import { cn } from "@feeblo/ui/utils";
import * as dayjs from "@feeblo/utils/dayjs";
import { slugify } from "@feeblo/utils/url";
import { parseRpcError } from "@feeblo/web-shared/rpc-error";
import {
  Archive01Icon,
  ArrowLeft02Icon,
  Calendar03Icon,
  Copy01Icon,
  Delete02Icon,
  Ellipsis,
  Link03Icon,
  LinkSquare02Icon,
  RefreshIcon,
  StatusIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { eq, useLiveQuery } from "@tanstack/react-db";
import { Link, useNavigate } from "@tanstack/react-router";
import * as Match from "effect/Match";
import { type ReactNode, useRef, useState } from "react";

import { CoverImageField } from "~/components/cover-image-field";
import { EditorLayout } from "~/components/editor-layout";
import { PublishDialog } from "~/components/publish-dialog";
import { usePublicSiteUrl } from "~/hooks/use-site";
import { useDashboardCollections } from "~/providers/dashboard-collections-provider";

import {
  createHelpCenterArticleAtom,
  deleteHelpCenterArticleAtom,
  helpCenterArticleReactivityKeys,
  updateHelpCenterArticleAtom,
} from "../atoms";
import {
  helpCenterArticleFormOptions,
  helpCenterArticleFormValues,
  type HelpCenterArticleFormValues,
} from "../help-center-forms";
import { HelpCenterArticleStatusBadge } from "./help-center-article-status";
import { HelpCenterTopicIcon } from "./help-center-topic-icon";

/**
 * What one submit changes beyond the form's own values.
 *
 * The status is not a field: it moves through the actions below, the way the
 * changelog's does, so there is one place that decides whether an article is
 * live. `publishedAt` is an override too because "turn into draft" has to clear
 * it while "archive" keeps it.
 */
type ArticleSubmitOverrides = {
  publishedAt?: Date | null;
  slug?: string;
  status?: THelpCenterArticleWriteState;
};

type ArticleSubmitMeta = {
  overrides?: ArticleSubmitOverrides;
};

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
  | {
      /**
       * The section a new article belongs to.
       *
       * It comes from the route (`/help-center/<topicId>/new`), so the create
       * page opens with its section already chosen. The field is still editable
       * because an article filed in the wrong place is worse than one more
       * click.
       */
      readonly mode: "create";
      readonly organizationId: string;
      readonly topicId: string;
    }
  | {
      readonly article: {
        readonly content: string;
        readonly coverImage: string | null;
        readonly createdAt: Date;
        readonly id: string;
        readonly position: number | null;
        readonly publishedAt: Date | null;
        readonly slug: string;
        readonly status: THelpCenterArticleState;
        readonly title: string;
        readonly topicId: string;
        readonly updatedAt: Date;
      };
      readonly mode: "edit";
      readonly organizationId: string;
    };

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
  const publicSiteUrl = usePublicSiteUrl();

  const article = props.mode === "edit" ? props.article : undefined;

  const initialTopicId = props.mode === "create" ? props.topicId : undefined;

  /**
   * The upload scope of this editor, and the key that remounts the content
   * editor when the row underneath it changes.
   *
   * The same arrangement the changelog editor uses: images are uploaded under a
   * per-editor scope, so a save only promotes the files this editor uploaded
   * and never a colleague's in-flight ones.
   */
  const [editorScope] = useState(() => crypto.randomUUID());

  /**
   * The asset id of the cover image this session uploaded.
   *
   * A cover uploads immediately, outside the body's deferred uploads, so its id
   * has to be remembered here to travel in `assetIds` on save — otherwise the
   * object stays in the temporary prefix and is reaped.
   */
  const coverImageAssetRef = useRef<string | null>(null);

  const formResetKey = `${article?.id ?? "new"}:${article?.updatedAt.getTime() ?? 0}`;

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

  /**
   * The status the editor opened on, kept for the write's conflict check.
   *
   * A `useState` initialiser rather than a read of `article.status` at submit
   * time: the atom's stale-while-revalidate refreshes the article underneath the
   * form, so by the time an editor saves, `article.status` may be a colleague's
   * newer value — and using it would make the constraint compare the row to
   * itself and always pass. This is what the form was seeded with, and it does
   * not move.
   */
  const [openedStatus] = useState(() => article?.status);

  /**
   * The last refused save or delete.
   *
   * A local string rather than the form's `errorMap`: `onSubmit` on a zod-
   * validated form is a structured `{ form, fields }` payload, and writing into
   * it meant narrowing a union at the render site to print one sentence. This
   * clears at the start of every attempt, which is the only drift a message
   * like this can have.
   */
  const [submitError, setSubmitError] = useState<string | null>(null);

  const createArticle = useAtomSet(createHelpCenterArticleAtom, {
    mode: "promise",
  });

  const updateArticle = useAtomSet(updateHelpCenterArticleAtom, {
    mode: "promise",
  });

  const deleteArticle = useAtomSet(deleteHelpCenterArticleAtom, {
    mode: "promise",
  });

  const form = useAppForm({
    ...helpCenterArticleFormOptions,
    defaultValues: {
      ...helpCenterArticleFormValues(article),
      // Only the create flow has a section chosen before the form exists; an
      // edit seeds its topic from the article itself.
      ...(article === undefined && initialTopicId !== undefined
        ? { topicId: initialTopicId }
        : {}),
    },
    onSubmit: async ({ meta, value }) => {
      /**
       * A refused write is shown, not thrown.
       *
       * `handleSubmit` rethrows a rejected `onSubmit`, so leaving the failure to
       * propagate would both skip the form's error slot — nothing writes
       * `errorMap.onSubmit` on that path — and leave `void form.handleSubmit()`
       * in the submit handler with an unhandled rejection. Catching here puts
       * the server's own message where the block below renders it, and the next
       * submission replaces it.
       */
      setSubmitError(null);

      // SAFETY: The runtime invariant checked by the surrounding code guarantees this type.
      const overrides = (meta as ArticleSubmitMeta | undefined)?.overrides;

      try {
        await submit(value, overrides);
      } catch (cause) {
        setSubmitError(parseRpcError(cause).message);
      }
    },
  });

  const backTopicId = article === undefined ? initialTopicId : article.topicId;
  const backTopic = topics.find((topic) => topic.id === backTopicId);

  async function submit(
    value: HelpCenterArticleFormValues,
    overrides: ArticleSubmitOverrides | undefined
  ) {
    /**
     * Resolve the images pasted into this editor before the write.
     *
     * `PostContentEditor` holds pasted files as object URLs until a save, and
     * this is the save: the files go to the temporary prefix, the content is
     * rewritten to their uploaded URLs, and the ids travel with the write so
     * the server can promote them to permanent objects.
     */
    const finalized = await finalizeEditorContent(
      value.content,
      organizationId,
      { scope: editorScope }
    );

    const content = finalized.content;
    const topicId = value.topicId;
    const title = value.title.trim();
    const status = overrides?.status ?? value.status;

    // The slug is only ever set by the publish dialog. A save keeps the row's
    // current slug (or lets the server derive one from the title on create),
    // so editing cannot silently move a live page's URL.
    const slug = overrides?.slug?.trim();

    const coverImageAssetId = coverImageAssetRef.current;

    const assetIds =
      coverImageAssetId === null
        ? finalized.assetIds
        : [...finalized.assetIds, coverImageAssetId];

    // An explicit override wins, including the explicit `null` that turning an
    // article back into a draft needs. Without one the stored date is kept, so
    // a typo fix does not look like a new release; a create has no stored date
    // to keep.
    const publishedAt =
      overrides !== undefined && "publishedAt" in overrides
        ? (overrides.publishedAt ?? null)
        : status === "draft"
          ? null
          : (article?.publishedAt ?? new Date());

    if (article === undefined) {
      const id = await HelpCenterArticleId.unsafeGenerate();

      await createArticle({
        payload: {
          assetIds,
          coverImage: value.coverImage,
          id,
          organizationId,
          topicId,
          title,
          // Omitted rather than sent as "": the server derives the slug from
          // the title, and an empty string is refused rather than treated as
          // "no preference".
          slug: slug === undefined || slug.length === 0 ? undefined : slug,
          content,
          status,
          publishedAt,
          position: null,
        },
        reactivityKeys: helpCenterArticleReactivityKeys(organizationId),
      });
    } else {
      await updateArticle({
        payload: {
          assetIds,
          coverImage: value.coverImage,
          id: article.id,
          organizationId,
          topicId,
          title,
          slug: slug === undefined || slug.length === 0 ? article.slug : slug,
          content,
          status,
          // What this editor opened on, not what a background refresh has
          // since put there: a row that moved is refused as a conflict rather
          // than silently reverted.
          expectedStatus: openedStatus ?? article.status,
          publishedAt,
          position: article.position,
        },
        reactivityKeys: helpCenterArticleReactivityKeys(organizationId),
      });
    }

    // The write was accepted, so the uploaded files are permanent now and
    // must not be re-uploaded by a later save from this editor.
    finalized.commit();

    // The list's rows are summaries the collection owns; the write above
    // refreshed the single-article atom through its reactivity keys, so there
    // is no cache entry here to forget.
    await helpCenterArticleCollection.utils.refetch();
    await navigate({
      params: { organizationId, topicId },
      to: "/$organizationId/help-center/$topicId",
    });
  }

  const remove = async () => {
    if (article === undefined) {
      return;
    }

    try {
      await deleteArticle({
        payload: { id: article.id, organizationId },
        // Carries the same keys as the read, so a back-navigation to a deleted
        // article finds no cached success to paint.
        reactivityKeys: helpCenterArticleReactivityKeys(organizationId),
      });

      await helpCenterArticleCollection.utils.refetch();
      await navigate({
        params: { organizationId, topicId: article.topicId },
        to: "/$organizationId/help-center/$topicId",
      });
    } catch (cause) {
      // The same message area the save uses: `remove` is not part of a submit,
      // so throwing would surface as an unhandled rejection from the button's
      // `void remove()` rather than as a message.
      setSubmitError(parseRpcError(cause).message);
    }
  };

  return (
    <form
      className="contents"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void form.handleSubmit();
      }}
    >
      <EditorLayout>
        <EditorLayout.Main>
          <EditorLayout.Header className="items-center gap-3">
            {backTopicId === undefined ? (
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
            ) : (
              <Button
                render={
                  <Link
                    params={{ organizationId, topicId: backTopicId }}
                    to="/$organizationId/help-center/$topicId"
                  />
                }
                size="sm"
                type="button"
                variant="ghost"
              >
                <HugeiconsIcon icon={ArrowLeft02Icon} />
                {backTopic?.name ?? "Section"}
              </Button>
            )}
          </EditorLayout.Header>

          <form.AppField name="coverImage">
            {(field) => (
              <CoverImageField
                assetRef={coverImageAssetRef}
                onChange={field.handleChange}
                organizationId={organizationId}
                value={field.state.value}
              />
            )}
          </form.AppField>

          <form.AppField name="title">
            {(field) => (
              <field.TextField
                className="rounded-md border-none bg-transparent font-medium tracking-tight md:text-2xl"
                hideLabel
                label="Title"
                maxLength={200}
                placeholder="Untitled article"
              />
            )}
          </form.AppField>

          <form.AppField name="content">
            {(field) => (
              <PostContentEditor
                editorScope={editorScope}
                key={formResetKey}
                onChange={field.handleChange}
                organizationId={organizationId}
                showBlockHandle
                value={field.state.value}
              />
            )}
          </form.AppField>

          {submitError === null ? null : (
            <p className="text-destructive text-sm">{submitError}</p>
          )}

          <div className="flex justify-end pt-2">
            <form.Subscribe
              selector={(state) => ({
                isSubmitting: state.isSubmitting,
                title: state.values.title,
              })}
            >
              {(state) => (
                <div className="flex items-center gap-2">
                  <Button
                    loading={state.isSubmitting}
                    type="submit"
                    variant="outline"
                  >
                    Save
                  </Button>
                  {Match.value(article?.status).pipe(
                    Match.when("published", () => (
                      <Button
                        disabled={state.isSubmitting}
                        onClick={() =>
                          void form.handleSubmit({
                            overrides: { publishedAt: null, status: "draft" },
                          })
                        }
                        type="button"
                        variant="brand"
                      >
                        Turn into draft
                      </Button>
                    )),
                    Match.when("archived", () => (
                      <Button
                        disabled={state.isSubmitting}
                        onClick={() =>
                          void form.handleSubmit({
                            overrides: { publishedAt: null, status: "draft" },
                          })
                        }
                        type="button"
                        variant="brand"
                      >
                        Restore to draft
                      </Button>
                    )),
                    Match.orElse(() => (
                      <PublishDialog
                        defaultPublishedAt={article?.publishedAt ?? null}
                        defaultSlug={
                          article?.slug ?? slugify(state.title.trim())
                        }
                        description="Choose the public URL and publication date for this article."
                        failureTitle="Failed to publish article"
                        onPublish={({ publishedAt, slug }) =>
                          form.handleSubmit({
                            overrides: {
                              publishedAt,
                              slug,
                              status: "published",
                            },
                          })
                        }
                        submitLabel="Publish"
                        title="Publish article"
                      />
                    ))
                  )}
                </div>
              )}
            </form.Subscribe>
          </div>
        </EditorLayout.Main>

        <EditorLayout.Sidebar>
          {article === undefined ? null : (
            <div className="flex items-center justify-end gap-2">
              {publicSiteUrl === undefined ||
              article.status === "draft" ? null : (
                <>
                  <Tooltip>
                    <TooltipTrigger
                      render={(triggerProps) => (
                        <Button
                          {...triggerProps}
                          aria-label="Go to public article"
                          className="rounded-full"
                          render={(buttonProps) => (
                            <a
                              {...buttonProps}
                              href={`${publicSiteUrl}/s/help/articles/${article.slug}`}
                              rel="noopener noreferrer"
                              target="_blank"
                            >
                              <HugeiconsIcon icon={LinkSquare02Icon} />
                            </a>
                          )}
                          size="icon-sm"
                          type="button"
                          variant="outline"
                        />
                      )}
                    />
                    <TooltipPopup>Go to public article</TooltipPopup>
                  </Tooltip>

                  <Tooltip>
                    <TooltipTrigger
                      render={(triggerProps) => (
                        <Button
                          {...triggerProps}
                          aria-label="Copy article link"
                          className="rounded-full"
                          onClick={async () => {
                            try {
                              await navigator.clipboard.writeText(
                                `${publicSiteUrl}/s/help/articles/${article.slug}`
                              );
                              toastManager.add({
                                title: "Article link copied to clipboard",
                                type: "success",
                              });
                            } catch {
                              toastManager.add({
                                title: "Failed to copy article link",
                                type: "error",
                              });
                            }
                          }}
                          size="icon-sm"
                          type="button"
                          variant="outline"
                        />
                      )}
                    />
                    <TooltipPopup>Copy article link</TooltipPopup>
                  </Tooltip>
                </>
              )}
              {article.status === "published" ? (
                <Menu>
                  <MenuTrigger
                    render={
                      <Button
                        aria-label="More article actions"
                        className="rounded-full"
                        size="icon-sm"
                        type="button"
                        variant="outline"
                      />
                    }
                  >
                    <HugeiconsIcon icon={Ellipsis} />
                  </MenuTrigger>
                  <MenuPopup align="end">
                    <MenuItem
                      onClick={() =>
                        void form.handleSubmit({
                          overrides: { status: "archived" },
                        })
                      }
                    >
                      <HugeiconsIcon icon={Archive01Icon} />
                      Archive article
                    </MenuItem>
                  </MenuPopup>
                </Menu>
              ) : null}
              <Tooltip>
                <TooltipTrigger
                  render={(triggerProps) => (
                    <Button
                      {...triggerProps}
                      aria-label="Delete article"
                      className="rounded-full"
                      onClick={() => void remove()}
                      size="icon-sm"
                      type="button"
                      variant="outline"
                    >
                      <HugeiconsIcon icon={Delete02Icon} />
                    </Button>
                  )}
                />
                <TooltipPopup>Delete article</TooltipPopup>
              </Tooltip>
            </div>
          )}

          <form.AppField name="topicId">
            {(field) => (
              <fieldset className="flex flex-col gap-2">
                <legend className="text-sm font-medium">Section</legend>
                <div className="flex flex-wrap gap-2">
                  {topics.map((topic) => (
                    <EditorChip
                      active={field.state.value === topic.id}
                      key={topic.id}
                      onClick={() => field.handleChange(topic.id)}
                    >
                      <HelpCenterTopicIcon
                        className="size-4"
                        icon={topic.icon}
                      />
                      {topic.name}
                    </EditorChip>
                  ))}
                </div>
                {topics.length === 0 ? (
                  <p className="text-muted-foreground text-xs">
                    Create a section first — every article belongs to one.
                  </p>
                ) : null}
              </fieldset>
            )}
          </form.AppField>

          {article === undefined ? null : (
            <>
              <EditorLayout.SidebarSeparator />
              <ArticleDetails article={article} />
            </>
          )}
        </EditorLayout.Sidebar>
      </EditorLayout>
    </form>
  );
}

function EditorChip({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      aria-pressed={active}
      className={cn(
        "inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm transition-colors",
        active
          ? "border-primary/50 bg-primary/10 text-primary"
          : "text-muted-foreground hover:bg-muted hover:text-foreground"
      )}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}

/** What the row says about itself, read-only. */
function ArticleDetails({
  article,
}: {
  article: {
    createdAt: Date;
    publishedAt: Date | null;
    slug: string;
    status: THelpCenterArticleState;
    updatedAt: Date;
  };
}) {
  const details: Array<{
    icon: typeof Calendar03Icon;
    label: string;
    value: ReactNode;
  }> = [
    {
      icon: Link03Icon,
      label: "Slug",
      value: article.slug,
    },
    {
      icon: StatusIcon,
      label: "Status",
      value: <HelpCenterArticleStatusBadge status={article.status} />,
    },
    {
      icon: Calendar03Icon,
      label: "Published",
      value:
        article.publishedAt === null
          ? "Not published"
          : dayjs.default(article.publishedAt).format("D MMM YYYY"),
    },
    {
      icon: RefreshIcon,
      label: "Updated",
      value: dayjs.default(article.updatedAt).fromNow(),
    },
  ];

  return (
    <section aria-labelledby="help-center-article-details-heading">
      <h2 className="sr-only" id="help-center-article-details-heading">
        Details
      </h2>
      <dl className="space-y-2">
        {details.map((detail) => (
          <div
            className="grid grid-cols-[1rem_minmax(0,1fr)_auto] items-center gap-2 text-xs"
            key={detail.label}
          >
            <HugeiconsIcon
              aria-hidden="true"
              className="text-muted-foreground/72 size-4"
              icon={detail.icon}
              strokeWidth={1.75}
            />
            <dt className="text-muted-foreground">{detail.label}</dt>
            <dd className="text-foreground max-w-32 truncate font-medium">
              {detail.value}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
