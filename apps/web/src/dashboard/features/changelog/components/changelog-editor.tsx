import { PostContentEditor } from "@feeblo/post-ui/post-content";
import { PostTitleInput } from "@feeblo/post-ui/post-title-input";
import { Button } from "@feeblo/ui/button";
import { Card } from "@feeblo/ui/card";
import {
  Combobox,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
} from "@feeblo/ui/combobox";
import { finalizeEditorContent } from "@feeblo/ui/editor";
import { useAppForm } from "@feeblo/ui/hooks/form";
import { Spinner } from "@feeblo/ui/spinner";
import { toastManager } from "@feeblo/ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@feeblo/ui/tooltip";
import * as dayjs from "@feeblo/utils/dayjs";
import { isString } from "@feeblo/utils/runtime-kind";
import { trackEvent } from "@feeblo/web-shared/analytics-provider";
import {
  editorMediaUploadEndpoint,
  uploadedEditorMediaSchema,
} from "@feeblo/web-shared/auth-client";
import { hasPermission, usePolicy } from "@feeblo/web-shared/use-policy";
import {
  ArrowLeft01Icon,
  Calendar03Icon,
  Cancel01Icon,
  Clock01Icon,
  Copy01Icon,
  ImageRemove01Icon,
  ImageUpload01Icon,
  Link03Icon,
  LinkSquare02Icon,
  RefreshIcon,
  Search01Icon,
  StatusIcon,
  Trash2,
  UserIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { and, eq, queryOnce, useLiveQuery } from "@tanstack/react-db";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  createContext,
  type ReactNode,
  type RefObject,
  use,
  useCallback,
  useMemo,
  useRef,
  useState,
} from "react";
import { z } from "zod";

import { usePublicSiteUrl } from "~/hooks/use-site";
import { fetchRpc } from "~/lib/runtime";
import { useDashboardCollections } from "~/providers/dashboard-collections-provider";

import type { ChangelogStatus } from "../constants";
import {
  useChangelogDeleteDialogContext,
  useChangelogMoveToDraftDialogContext,
} from "../dialog-stores";
import { updatedChangelogSchema } from "../schema";
import { ChangelogPublishDialog } from "./changelog-publish-dialog";
import { ChangelogStatusBadge } from "./changelog-status";

export type TChangelogEditorRecord = {
  assetIds?: readonly string[];
  coverImage: string | null;
  id: string;
  title: string;
  slug: string;
  content: string;
  status: ChangelogStatus;
  scheduledAt: Date | null;
  publishedAt: Date | null;
  organizationId: string;
  creatorId: string | null;
  createdAt: Date;
  updatedAt: Date;
  user: {
    name: string | null;
    image: string | null;
  };
};

type ChangelogEditorFormValues = {
  title: string;
  content: string;
  coverImage: string | null;
};

type ChangelogSubmitMeta = {
  successTitle: string;
  overrides?: Partial<
    Pick<
      TChangelogEditorRecord,
      "publishedAt" | "scheduledAt" | "slug" | "status"
    >
  >;
};

type ChangelogEditorProviderProps = {
  changelog: TChangelogEditorRecord;
  children: ReactNode;
  organizationId: string;
};

function useChangelogEditorForm({
  changelog,
  editorScope,
  organizationId,
  coverImageAssetRef,
}: {
  changelog: TChangelogEditorRecord;
  editorScope: string;
  organizationId: string;
  coverImageAssetRef: RefObject<string | null>;
}) {
  const { changelogCollection } = useDashboardCollections();
  const navigate = useNavigate();

  return useAppForm({
    formId: `${changelog.id}:${changelog.updatedAt.getTime()}`,
    defaultValues: {
      title: changelog.title,
      content: changelog.content,
      coverImage: changelog.coverImage ?? null,
    } satisfies ChangelogEditorFormValues,
    validators: {
      onSubmit: z.object({
        title: z.string().trim().min(1, "Title is required"),
        content: z.string(),
        coverImage: z.string().nullable(),
      }),
    },
    onSubmit: async ({ value, meta }) => {
      // SAFETY: The runtime invariant checked by the surrounding code guarantees this type.
      const submitMeta = meta as ChangelogSubmitMeta | undefined;

      try {
        const finalized = await finalizeEditorContent(
          value.content,
          organizationId,
          { assetIds: changelog.assetIds, scope: editorScope }
        );
        const { assetIds: contentAssetIds, content } = finalized;
        const assetIds = [
          ...contentAssetIds,
          ...(coverImageAssetRef.current ? [coverImageAssetRef.current] : []),
        ];
        const payload = updatedChangelogSchema.parse({
          id: changelog.id,
          title: value.title.trim(),
          slug: submitMeta?.overrides?.slug ?? changelog.slug,
          content,
          coverImage: value.coverImage,
          assetIds,
          status: submitMeta?.overrides?.status ?? changelog.status,
          scheduledAt:
            submitMeta?.overrides && "scheduledAt" in submitMeta.overrides
              ? (submitMeta.overrides.scheduledAt ?? null)
              : changelog.scheduledAt,
          publishedAt:
            submitMeta?.overrides && "publishedAt" in submitMeta.overrides
              ? (submitMeta.overrides.publishedAt ?? null)
              : changelog.publishedAt,
          organizationId,
        });

        const tx = changelogCollection.update(changelog.id, (draft) => {
          draft.title = payload.title;
          draft.slug = payload.slug;
          draft.content = payload.content;
          draft.assetIds = payload.assetIds;
          draft.coverImage = payload.coverImage;
          draft.status = payload.status;
          draft.scheduledAt = payload.scheduledAt;
          draft.publishedAt = payload.publishedAt;
        });

        await tx.isPersisted.promise;
        finalized.commit();
        trackEvent("changelog_saved", {
          status: payload.status,
          success: true,
        });

        if (payload.slug !== changelog.slug) {
          await navigate({
            to: "/$organizationId/changelog/edit/$changelogSlug",
            params: { organizationId, changelogSlug: payload.slug },
            replace: true,
          });
        }

        toastManager.add({
          title: submitMeta?.successTitle ?? "Changelog saved",
          type: "success",
        });
      } catch {
        trackEvent("changelog_saved", {
          status: changelog.status,
          success: false,
        });
        toastManager.add({
          title: "Failed to update changelog",
          type: "error",
        });
      }
    },
  });
}

type ChangelogEditorContextValue = {
  changelog: TChangelogEditorRecord;
  coverImageAssetRef: RefObject<string | null>;
  form: ReturnType<typeof useChangelogEditorForm>;
  formResetKey: string;
  editorScope: string;
  handleDelete: () => Promise<void>;
  handleMoveToDraft: () => Promise<void>;
  isOwner: boolean;
  organizationId: string;
  submitDefault: () => void;
};

const ChangelogEditorContext =
  createContext<ChangelogEditorContextValue | null>(null);

export function ChangelogEditorProvider({
  changelog,
  children,
  organizationId,
}: ChangelogEditorProviderProps) {
  const navigate = useNavigate();
  const { changelogCollection } = useDashboardCollections();
  const [editorScope] = useState(() => crypto.randomUUID());
  const coverImageAssetRef = useRef<string | null>(null);
  const formResetKey = `${changelog.id}:${changelog.updatedAt.getTime()}`;
  // Backend mirror: ChangelogPolicy.canUpdate requires changelog.*.
  const { allowed: isOwner } = usePolicy(
    hasPermission(organizationId, "changelog.*")
  );
  const form = useChangelogEditorForm({
    changelog,
    editorScope,
    organizationId,
    coverImageAssetRef,
  });

  const handleMoveToDraft = useCallback(async () => {
    await form.handleSubmit({
      successTitle: "Moved to draft",
      overrides: {
        status: "draft",
        scheduledAt: null,
        publishedAt: null,
      },
    });
  }, [form]);

  const handleDelete = useCallback(async () => {
    try {
      const tx = changelogCollection.delete(changelog.id, {
        optimistic: false,
      });
      await tx.isPersisted.promise;
      trackEvent("changelog_deleted", { success: true });

      toastManager.add({
        title: "Changelog deleted",
        type: "success",
      });

      navigate({
        to: "/$organizationId/changelog",
        params: { organizationId },
      });
    } catch {
      trackEvent("changelog_deleted", { success: false });
      toastManager.add({
        title: "Failed to delete changelog",
        type: "error",
      });
    }
  }, [changelog.id, changelogCollection, navigate, organizationId]);

  const submitDefault = useCallback(() => {
    form.handleSubmit({ successTitle: "Changes saved" });
  }, [form]);
  const value = useMemo<ChangelogEditorContextValue>(
    () => ({
      changelog,
      coverImageAssetRef,
      editorScope,
      form,
      formResetKey,
      handleDelete,
      handleMoveToDraft,
      isOwner,
      organizationId,
      submitDefault,
    }),
    [
      changelog,
      coverImageAssetRef,
      editorScope,
      form,
      formResetKey,
      handleDelete,
      handleMoveToDraft,
      isOwner,
      organizationId,
      submitDefault,
    ]
  );

  return (
    <ChangelogEditorContext.Provider value={value}>
      {children}
    </ChangelogEditorContext.Provider>
  );
}

function useChangelogEditor() {
  const value = use(ChangelogEditorContext);

  if (!value) {
    throw new Error(
      "Changelog editor components must be used within the provider"
    );
  }

  return value;
}

export function useChangelogEditorContext() {
  return useChangelogEditor();
}

export function ChangelogEditorForm({ children }: { children: ReactNode }) {
  const { submitDefault } = useChangelogEditor();

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        submitDefault();
      }}
    >
      {children}
    </form>
  );
}

export function ChangelogEditorBackLink() {
  const { organizationId } = useChangelogEditor();

  return (
    <Button
      aria-label="Back to changelog"
      className="rounded-full transition-transform active:scale-[0.96]"
      render={(props) => (
        <Link
          {...props}
          params={{ organizationId }}
          to="/$organizationId/changelog"
        >
          <HugeiconsIcon icon={ArrowLeft01Icon} />
        </Link>
      )}
      size="icon-sm"
      variant="outline"
    />
  );
}

export function ChangelogEditorTitleField() {
  const { form, isOwner } = useChangelogEditor();

  return (
    <form.Field name="title">
      {(field) => (
        <PostTitleInput
          name={field.name}
          onBlur={field.handleBlur}
          onChange={
            isOwner
              ? (event) => {
                  field.handleChange(event.target.value);
                }
              : undefined
          }
          placeholder="Untitled changelog"
          readOnly={!isOwner}
          value={field.state.value}
        />
      )}
    </form.Field>
  );
}

export function ChangelogEditorCoverImageField() {
  const { coverImageAssetRef, form, isOwner, organizationId } =
    useChangelogEditor();
  const inputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);

  const uploadCoverImage = async (file: File) => {
    setIsUploading(true);
    try {
      const { assetId, url } = await uploadChangelogCoverImage(
        file,
        organizationId
      );
      coverImageAssetRef.current = assetId;
      form.setFieldValue("coverImage", url);
      toastManager.add({
        title: "Cover image added",
        type: "success",
      });
    } catch {
      toastManager.add({
        title: "Failed to upload cover image",
        type: "error",
      });
    } finally {
      setIsUploading(false);
    }
  };

  const removeCoverImage = () => {
    coverImageAssetRef.current = null;
    form.setFieldValue("coverImage", null);
  };

  return (
    <form.Field name="coverImage">
      {(field) => (
        <>
          {field.state.value ? (
            <Card className="overflow-hidden" size="sm">
              <div className="relative">
                <img
                  alt=""
                  className="aspect-[16/7] w-full object-cover"
                  height={525}
                  src={field.state.value}
                  width={1200}
                />
                {isOwner ? (
                  <div className="absolute inset-x-0 bottom-0 flex justify-end gap-2 bg-gradient-to-t from-black/50 to-transparent p-3">
                    <Button
                      aria-label="Replace cover image"
                      disabled={isUploading}
                      onClick={() => inputRef.current?.click()}
                      size="sm"
                      type="button"
                      variant="destructive"
                    >
                      {isUploading ? (
                        <Spinner className="size-4" />
                      ) : (
                        <HugeiconsIcon icon={ImageUpload01Icon} />
                      )}
                      Replace
                    </Button>
                    <Button
                      aria-label="Remove cover image"
                      disabled={isUploading}
                      onClick={removeCoverImage}
                      size="sm"
                      type="button"
                      variant="destructive"
                    >
                      <HugeiconsIcon icon={ImageRemove01Icon} />
                      Remove
                    </Button>
                  </div>
                ) : null}
              </div>
            </Card>
          ) : (
            <Card className="h-32 items-center justify-center" size="sm">
              <Button
                aria-label="Add cover image"
                disabled={!isOwner || isUploading}
                onClick={() => inputRef.current?.click()}
                type="button"
                variant="secondary"
              >
                {isUploading ? (
                  <Spinner className="size-4" />
                ) : (
                  <HugeiconsIcon icon={ImageUpload01Icon} />
                )}
                Add cover image
              </Button>
            </Card>
          )}
          <input
            accept="image/gif,image/jpeg,image/png,image/webp"
            className="hidden"
            disabled={!isOwner}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) {
                uploadCoverImage(file).catch(() => undefined);
              }
              event.target.value = "";
            }}
            ref={inputRef}
            type="file"
          />
        </>
      )}
    </form.Field>
  );
}

async function uploadChangelogCoverImage(
  file: File,
  organizationId: string
): Promise<{ assetId: string; url: string }> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("organizationId", organizationId);

  const response = await fetch(editorMediaUploadEndpoint, {
    method: "POST",
    credentials: "include",
    body: formData,
  });

  if (!response.ok) {
    throw new Error(`Cover image upload failed with status ${response.status}`);
  }

  return uploadedEditorMediaSchema.parse(await response.json());
}

export function ChangelogEditorSubmitAction() {
  const { changelog, form, isOwner } = useChangelogEditor();
  const moveToDraftDialogStore = useChangelogMoveToDraftDialogContext();

  if (!isOwner) {
    return null;
  }

  return (
    <form.Subscribe selector={(state) => state.isSubmitting}>
      {(isSubmitting) => (
        <div className="flex items-center gap-2">
          <Button disabled={isSubmitting} type="submit" variant="outline">
            Save
          </Button>
          {changelog.status === "published" ? (
            <Button
              disabled={isSubmitting}
              onClick={() =>
                moveToDraftDialogStore.send({
                  type: "toggle",
                  data: { changelogId: changelog.id },
                })
              }
              type="button"
              variant="brand"
            >
              Turn into draft
            </Button>
          ) : (
            <ChangelogPublishDialog
              defaultPublishedAt={changelog.publishedAt}
              defaultSlug={changelog.slug}
              key={changelog.status}
              onPublish={({ publishedAt, slug }) =>
                form.handleSubmit({
                  successTitle: "Changelog published",
                  overrides: {
                    slug,
                    status: "published",
                    publishedAt,
                    scheduledAt: null,
                  },
                })
              }
              triggerLabel="Publish"
            />
          )}
        </div>
      )}
    </form.Subscribe>
  );
}

export function ChangelogEditorContentField() {
  const { editorScope, form, formResetKey, isOwner, organizationId } =
    useChangelogEditor();

  const isDisabled = !isOwner;
  return (
    <form.Field name="content">
      {(field) => (
        <PostContentEditor
          editorScope={editorScope}
          key={formResetKey}
          onChange={field.handleChange}
          organizationId={organizationId}
          readOnly={isDisabled}
          showBlockHandle={!isDisabled}
          value={field.state.value}
        />
      )}
    </form.Field>
  );
}

export function ChangelogEditorDetails() {
  const { changelog } = useChangelogEditor();
  const details: Array<{
    icon: typeof Link03Icon;
    label: string;
    value: ReactNode;
  }> = [
    {
      icon: Link03Icon,
      label: "Slug",
      value: changelog.slug,
    },
    {
      icon: UserIcon,
      label: "Author",
      value: changelog.user.name ?? "Unknown author",
    },
    {
      icon: StatusIcon,
      label: "Status",
      value: <ChangelogStatusBadge status={changelog.status} />,
    },
    {
      icon: Clock01Icon,
      label: "Publish At",
      value: formatPublishAt(changelog.publishedAt, changelog.scheduledAt),
    },
    {
      icon: Calendar03Icon,
      label: "Created",
      value: dayjs.default(changelog.createdAt).fromNow(),
    },
    {
      icon: RefreshIcon,
      label: "Updated",
      value: dayjs.default(changelog.updatedAt).fromNow(),
    },
  ];

  return (
    <section
      aria-labelledby="changelog-details-heading"
      className="space-y-2.5"
    >
      <h2 className="sr-only" id="changelog-details-heading">
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
            <dd
              className={
                isString(detail.value)
                  ? "text-foreground max-w-32 truncate font-medium"
                  : "text-foreground font-medium"
              }
            >
              {detail.value}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function ChangelogEditorCategoryField() {
  const { changelog, isOwner, organizationId } = useChangelogEditor();
  const { changelogCategoryCollection, changelogCategoryLinkCollection } =
    useDashboardCollections();

  const categoriesQuery = useLiveQuery(
    (q) =>
      q
        .from({ category: changelogCategoryCollection })
        .where(({ category }) => eq(category.organizationId, organizationId))
        .orderBy(({ category }) => category.createdAt, "asc"),
    [organizationId]
  );
  const categories = categoriesQuery.data ?? [];

  const linksQuery = useLiveQuery(
    (q) =>
      q
        .from({ link: changelogCategoryLinkCollection })
        .where(({ link }) =>
          and(
            eq(link.changelogId, changelog.id),
            eq(link.organizationId, organizationId)
          )
        ),
    [organizationId, changelog.id]
  );
  const links = linksQuery.data ?? [];

  const selectedCategoryIds = new Set(links.map((link) => link.categoryId));
  const selectedCategories = categories.filter((category) =>
    selectedCategoryIds.has(category.id)
  );

  const updateCategories = async (nextCategoryIds: readonly string[]) => {
    if (!isOwner) {
      return;
    }
    try {
      await fetchRpc((rpc) =>
        rpc.ChangelogCategorySet({
          changelogId: changelog.id,
          organizationId,
          categoryIds: [...nextCategoryIds],
        })
      );
      await changelogCategoryLinkCollection.utils.refetch();
      toastManager.add({
        title: "Categories updated",
        type: "success",
      });
    } catch {
      toastManager.add({
        title: "Failed to update categories",
        type: "error",
      });
    }
  };

  const handleValueChange = async (nextSelected: typeof selectedCategories) => {
    const nextIds = new Set(nextSelected.map((category) => category.id));
    const nextCategoryIds: string[] = [];
    for (const category of categories) {
      if (nextIds.has(category.id)) {
        nextCategoryIds.push(category.id);
      }
    }
    await updateCategories(nextCategoryIds);
  };

  const removeCategory = async (categoryId: string) => {
    // Read the freshest confirmed links straight from the collection instead
    // of React-synced state, so rapid add/remove sequences build their
    // payloads from the latest data rather than a stale render snapshot.
    const currentLinks = await queryOnce((q) =>
      q
        .from({ link: changelogCategoryLinkCollection })
        .where(({ link }) =>
          and(
            eq(link.changelogId, changelog.id),
            eq(link.organizationId, organizationId)
          )
        )
        .select(({ link }) => ({ categoryId: link.categoryId }))
    );

    const nextCategoryIds: string[] = [];
    for (const link of currentLinks) {
      if (link.categoryId !== categoryId) {
        nextCategoryIds.push(link.categoryId);
      }
    }
    await updateCategories(nextCategoryIds);
  };

  return (
    <div className="flex flex-col gap-2">
      <Combobox
        disabled={!isOwner}
        items={categories}
        multiple
        onValueChange={handleValueChange}
        value={selectedCategories}
      >
        <ComboboxInput
          aria-label="Add categories"
          placeholder="Add categories..."
          size="sm"
          startAddon={<HugeiconsIcon icon={Search01Icon} strokeWidth={2} />}
        />
        <ComboboxPopup aria-label="Select categories">
          <ComboboxEmpty>No categories found.</ComboboxEmpty>
          <ComboboxList>
            {(category) => (
              <ComboboxItem key={category.id} value={category}>
                <span className="flex items-center gap-2 whitespace-nowrap">
                  <span
                    aria-hidden="true"
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: category.icon }}
                  />
                  {category.name}
                </span>
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxPopup>
      </Combobox>

      {selectedCategories.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5">
          {selectedCategories.map((category) => (
            <li
              className="border-input bg-background flex min-w-0 items-center gap-1 rounded-md border py-0.5 ps-2 pe-0.5 text-sm"
              key={category.id}
            >
              <span
                aria-hidden="true"
                className="size-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: category.icon }}
              />
              <span className="truncate font-medium">{category.name}</span>
              <Button
                aria-label={`Remove ${category.name}`}
                disabled={!isOwner}
                onClick={() => removeCategory(category.id)}
                size="icon-xs"
                variant="ghost"
              >
                <HugeiconsIcon icon={Cancel01Icon} />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function ChangelogEditorSidebarActions() {
  const { changelog, isOwner } = useChangelogEditor();
  const deleteDialogStore = useChangelogDeleteDialogContext();
  const publicSiteUrl = usePublicSiteUrl();

  return (
    <div className="flex items-center justify-end gap-2">
      {publicSiteUrl ? (
        <>
          <Tooltip>
            <TooltipTrigger
              render={(props) => (
                <Button
                  {...props}
                  aria-label="Go to public changelog"
                  className="rounded-full"
                  render={(buttonProps) => (
                    <a
                      {...buttonProps}
                      href={`${publicSiteUrl}/changelog/${changelog.slug}`}
                      rel="noopener noreferrer"
                      target="_blank"
                    >
                      <HugeiconsIcon icon={LinkSquare02Icon} />
                    </a>
                  )}
                  size="icon-sm"
                  variant="outline"
                />
              )}
            />
            <TooltipPopup>Go to public changelog</TooltipPopup>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger
              render={(props) => (
                <Button
                  {...props}
                  aria-label="Copy changelog link"
                  className="rounded-full"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(
                        `${publicSiteUrl}/changelog/${changelog.slug}`
                      );
                      toastManager.add({
                        title: "Changelog link copied to clipboard",
                        type: "success",
                      });
                    } catch {
                      toastManager.add({
                        title: "Failed to copy changelog link",
                        type: "error",
                      });
                    }
                  }}
                  size="icon-sm"
                  variant="outline"
                >
                  <HugeiconsIcon icon={Copy01Icon} />
                </Button>
              )}
            />
            <TooltipPopup>Copy changelog link</TooltipPopup>
          </Tooltip>
        </>
      ) : null}

      {isOwner ? (
        <Tooltip>
          <TooltipTrigger
            render={(props) => (
              <Button
                {...props}
                aria-label="Delete changelog"
                className="rounded-full"
                onClick={() =>
                  deleteDialogStore.send({
                    type: "toggle",
                    data: { changelogId: changelog.id },
                  })
                }
                size="icon-sm"
                variant="outline"
              >
                <HugeiconsIcon icon={Trash2} />
              </Button>
            )}
          />
          <TooltipPopup>Delete changelog</TooltipPopup>
        </Tooltip>
      ) : null}
    </div>
  );
}

const mediumDateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
});

function formatDate(date: Date) {
  return mediumDateFormatter.format(date);
}

function formatPublishAt(publishedAt: Date | null, scheduledAt: Date | null) {
  const value = publishedAt ?? scheduledAt;

  if (!value) {
    return "Not scheduled";
  }

  return formatDate(value);
}
