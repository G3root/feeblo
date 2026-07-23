import { PostContentEditor } from "@feeblo/post-ui/post-content";
import { PostTitleInput } from "@feeblo/post-ui/post-title-input";
import { Button } from "@feeblo/ui/button";
import { useAppForm } from "@feeblo/ui/hooks/form";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "@feeblo/ui/menu";
import { toastManager } from "@feeblo/ui/toast";
import { trackEvent } from "@feeblo/web-shared/analytics-provider";
import {
  allPolicy,
  hasMembership,
  isUser,
  usePolicy,
} from "@feeblo/web-shared/use-policy";
import {
  ArrowLeft01Icon,
  Delete02Icon,
  Ellipsis,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link, useNavigate } from "@tanstack/react-router";
import { createContext, type ReactNode, use } from "react";
import { z } from "zod";
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
  organizationId,
}: {
  changelog: TChangelogEditorRecord;
  organizationId: string;
}) {
  const { changelogCollection } = useDashboardCollections();
  const navigate = useNavigate();

  return useAppForm({
    formId: `${changelog.id}:${changelog.updatedAt.getTime()}`,
    defaultValues: {
      title: changelog.title,
      content: changelog.content,
    } satisfies ChangelogEditorFormValues,
    validators: {
      onSubmit: z.object({
        title: z.string().trim().min(1, "Title is required"),
        content: z.string(),
      }),
    },
    onSubmit: async ({ value, meta }) => {
      const submitMeta = meta as ChangelogSubmitMeta | undefined;

      try {
        const payload = updatedChangelogSchema.parse({
          id: changelog.id,
          title: value.title.trim(),
          slug: submitMeta?.overrides?.slug ?? changelog.slug,
          content: value.content,
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
          draft.status = payload.status;
          draft.scheduledAt = payload.scheduledAt;
          draft.publishedAt = payload.publishedAt;
        });

        await tx.isPersisted.promise;
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
      } catch (_error) {
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
  form: ReturnType<typeof useChangelogEditorForm>;
  formResetKey: string;
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
  const formResetKey = `${changelog.id}:${changelog.updatedAt.getTime()}`;
  const { allowed: isOwner } = usePolicy(
    allPolicy(hasMembership(organizationId), isUser(changelog.creatorId ?? ""))
  );
  const form = useChangelogEditorForm({ changelog, organizationId });

  async function handleMoveToDraft() {
    await form.handleSubmit({
      successTitle: "Moved to draft",
      overrides: {
        status: "draft",
        scheduledAt: null,
        publishedAt: null,
      },
    });
  }

  async function handleDelete() {
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
    } catch (_error) {
      trackEvent("changelog_deleted", { success: false });
      toastManager.add({
        title: "Failed to delete changelog",
        type: "error",
      });
    }
  }

  const value: ChangelogEditorContextValue = {
    changelog,
    form,
    formResetKey,
    handleDelete,
    handleMoveToDraft,
    isOwner,
    organizationId,
    submitDefault: () => {
      form.handleSubmit({ successTitle: "Changes saved" });
    },
  };

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
  const { form, formResetKey, isOwner } = useChangelogEditor();

  const isDisabled = !isOwner;
  return (
    <form.Field name="content">
      {(field) => (
        <PostContentEditor
          key={formResetKey}
          onChange={field.handleChange}
          readOnly={isDisabled}
          showBlockHandle={!isDisabled}
          value={field.state.value}
        />
      )}
    </form.Field>
  );
}

export function ChangelogEditorStatus() {
  const { changelog } = useChangelogEditor();

  return <ChangelogStatusBadge status={changelog.status} />;
}

export function ChangelogEditorMetadata() {
  const { changelog } = useChangelogEditor();

  return (
    <>
      <MetadataRow label="Slug" value={changelog.slug} />
      <MetadataRow
        label="Author"
        value={changelog.user.name ?? "Unknown author"}
      />
      <MetadataRow
        label="Publish At"
        value={formatDateTime(changelog.publishedAt, changelog.scheduledAt)}
      />
      <MetadataRow
        label="Created"
        value={changelog.createdAt.toLocaleDateString()}
      />
      <MetadataRow
        label="Updated"
        value={changelog.updatedAt.toLocaleDateString()}
      />
    </>
  );
}

export function ChangelogEditorMoreActions() {
  const { changelog, isOwner } = useChangelogEditor();
  const deleteDialogStore = useChangelogDeleteDialogContext();

  if (!isOwner) {
    return null;
  }

  return (
    <Menu>
      <MenuTrigger
        render={(props) => (
          <Button
            {...props}
            aria-label="More actions"
            className="rounded-full transition-transform active:scale-[0.96]"
            size="icon-sm"
            variant="outline"
          >
            <HugeiconsIcon icon={Ellipsis} />
          </Button>
        )}
      />
      <MenuPopup align="end" className="w-48">
        <MenuItem
          onClick={() =>
            deleteDialogStore.send({
              type: "toggle",
              data: { changelogId: changelog.id },
            })
          }
          variant="destructive"
        >
          <HugeiconsIcon icon={Delete02Icon} />
          <span>Delete</span>
        </MenuItem>
      </MenuPopup>
    </Menu>
  );
}

function MetadataRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <>
      <p className="text-muted-foreground text-xs uppercase tracking-[0.2em]">
        {label}
      </p>
      <div className="text-sm">{value}</div>
    </>
  );
}

function formatDateTime(publishedAt: Date | null, scheduledAt: Date | null) {
  const value = publishedAt ?? scheduledAt;

  if (!value) {
    return "Not scheduled";
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);
}
