import { Link, useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { z } from "zod";
import { Button } from "~/components/ui/button";
import { Separator } from "~/components/ui/separator";
import { Skeleton } from "~/components/ui/skeleton";
import { toastManager } from "~/components/ui/toast";
import { PostContentEditor } from "~/features/post/components/post-content";
import { PostTitleInput } from "~/features/post/components/post-title-input";
import { useAppForm } from "~/hooks/form";
import {
  allPolicy,
  hasMembership,
  isUser,
  usePolicy,
} from "~/hooks/use-policy";
import { changelogCollection } from "~/lib/collections";
import type { ChangelogStatus } from "../constants";
import { updatedChangelogSchema } from "../schema";
import { ChangelogPublishDialog } from "./changelog-publish-dialog";
import { ChangelogStatusBadge } from "./changelog-status";

type TChangelogEditorRecord = {
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
    Pick<TChangelogEditorRecord, "publishedAt" | "scheduledAt" | "status">
  >;
};

export function ChangelogEditorScreen({
  changelog,
  organizationId,
}: {
  changelog: TChangelogEditorRecord;
  organizationId: string;
}) {
  const navigate = useNavigate();
  const formResetKey = `${changelog.id}:${changelog.updatedAt.getTime()}`;
  const { allowed: isOwner } = usePolicy(
    allPolicy(hasMembership(organizationId), isUser(changelog.creatorId ?? ""))
  );
  const form = useAppForm({
    formId: formResetKey,
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
          slug: changelog.slug,
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
          draft.content = payload.content;
          draft.status = payload.status;
          draft.scheduledAt = payload.scheduledAt;
          draft.publishedAt = payload.publishedAt;
        });

        await tx.isPersisted.promise;

        toastManager.add({
          title: submitMeta?.successTitle ?? "Changelog saved",
          type: "success",
        });
      } catch (_error) {
        toastManager.add({
          title: "Failed to update changelog",
          type: "error",
        });
      }
    },
  });

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

      toastManager.add({
        title: "Changelog deleted",
        type: "success",
      });

      navigate({
        to: "/$organizationId/changelog",
        params: { organizationId },
      });
    } catch (_error) {
      toastManager.add({
        title: "Failed to delete changelog",
        type: "error",
      });
    }
  }

  return (
    <form
      className="mx-auto w-full"
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        form.handleSubmit({ successTitle: "Changes saved" });
      }}
    >
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
        <section className="space-y-6 px-4 py-6 md:px-6 md:py-8">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1 space-y-3">
              <Link
                className="inline-block text-muted-foreground text-xs underline-offset-4 hover:underline"
                params={{ organizationId }}
                to="/$organizationId/changelog"
              >
                Back to changelog
              </Link>

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
            </div>

            {isOwner ? (
              <form.Subscribe selector={(state) => state.isSubmitting}>
                {(isSubmitting) =>
                  changelog.status === "published" ? (
                    <Button disabled={isSubmitting} type="submit">
                      Save
                    </Button>
                  ) : (
                    <ChangelogPublishDialog
                      currentStatus={changelog.status}
                      defaultScheduledAt={changelog.scheduledAt}
                      key={changelog.status}
                      onPublishNow={() =>
                        form.handleSubmit({
                          successTitle: "Changelog published",
                          overrides: {
                            status: "published",
                            publishedAt: new Date(),
                            scheduledAt: null,
                          },
                        })
                      }
                      onScheduleLater={(scheduledAt) =>
                        form.handleSubmit({
                          successTitle: "Changelog scheduled",
                          overrides: {
                            status: "scheduled",
                            scheduledAt,
                            publishedAt: null,
                          },
                        })
                      }
                      triggerLabel="Save"
                    />
                  )
                }
              </form.Subscribe>
            ) : null}
          </div>

          <form.Field name="content">
            {(field) => (
              <PostContentEditor
                disabled={!isOwner}
                key={formResetKey}
                onChange={field.handleChange}
                value={field.state.value}
              />
            )}
          </form.Field>
        </section>

        <aside className="h-fit space-y-4 border-l bg-muted/20 p-4 md:p-6">
          <div className="space-y-1">
            <p className="text-muted-foreground text-xs uppercase tracking-[0.2em]">
              Status
            </p>
            <ChangelogStatusBadge status={changelog.status} />
          </div>

          <Separator />

          <div className="space-y-3 text-sm">
            <MetadataRow label="Slug" value={changelog.slug} />
            <MetadataRow
              label="Author"
              value={changelog.user.name ?? "Unknown author"}
            />
            <MetadataRow
              label="Publish At"
              value={formatDateTime(
                changelog.publishedAt,
                changelog.scheduledAt
              )}
            />
            <MetadataRow
              label="Created"
              value={changelog.createdAt.toLocaleDateString()}
            />
            <MetadataRow
              label="Updated"
              value={changelog.updatedAt.toLocaleDateString()}
            />
          </div>

          {isOwner ? (
            <>
              {changelog.status !== "draft" ? (
                <Button
                  className="w-full"
                  onClick={handleMoveToDraft}
                  type="button"
                  variant="outline"
                >
                  Move to draft
                </Button>
              ) : null}
              <Separator />
              <Button
                className="w-full"
                onClick={handleDelete}
                type="button"
                variant="destructive"
              >
                Delete changelog
              </Button>
            </>
          ) : null}
        </aside>
      </div>
    </form>
  );
}

function MetadataRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="text-muted-foreground text-xs uppercase tracking-[0.2em]">
        {label}
      </p>
      <div className="text-sm">{value}</div>
    </div>
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

export function ChangelogEditorSkeleton() {
  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 md:px-6 md:py-8">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
        <section className="space-y-6">
          <div className="space-y-3">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-10 w-3/5" />
          </div>
          <Skeleton className="h-72 w-full rounded-2xl" />
        </section>

        <aside className="space-y-4 rounded-2xl border bg-muted/20 p-4">
          <Skeleton className="h-10 w-full" />
          <Separator />
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-4 w-24" />
        </aside>
      </div>
    </div>
  );
}
