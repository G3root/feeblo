import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "@feeblo/ui/alert-dialog";
import { Button } from "@feeblo/ui/button";
import { useAppForm } from "@feeblo/ui/hooks/form";
import { toastManager } from "@feeblo/ui/toast";
import { useState } from "react";
import { z } from "zod";

const publishSchema = z.object({
  slug: z.string().trim().min(1, "A slug is required"),
  publishedAt: z
    .string()
    .trim()
    .min(1, "A published date is required")
    .refine(
      (value) => !Number.isNaN(new Date(value).getTime()),
      "Enter a valid published date"
    ),
});

const publishFormOptions = {
  defaultValues: {
    slug: "",
    publishedAt: "",
  },
  validators: {
    onSubmit: publishSchema,
  },
};

/**
 * The "publish this" dialog: the public slug and the publication date.
 *
 * Shared by the changelog and help center editors because the two publish
 * operations ask the same two questions, and two dialogs would eventually
 * disagree about one of the answers.
 */
export function PublishDialog({
  defaultPublishedAt,
  defaultSlug,
  description,
  failureTitle,
  onPublish,
  submitLabel = "Save",
  title,
  triggerLabel = "Publish",
}: {
  defaultPublishedAt: Date | null;
  defaultSlug: string;
  description: string;
  failureTitle: string;
  onPublish: (values: { publishedAt: Date; slug: string }) => Promise<void>;
  submitLabel?: string;
  title: string;
  triggerLabel?: string;
}) {
  const [open, setOpen] = useState(false);

  const form = useAppForm({
    ...publishFormOptions,
    defaultValues: {
      slug: defaultSlug,
      publishedAt: toDatetimeLocalValue(defaultPublishedAt ?? new Date()),
    },
    onSubmit: async ({ value }) => {
      try {
        await onPublish({
          publishedAt: new Date(value.publishedAt),
          slug: value.slug,
        });
        form.reset();
        setOpen(false);
      } catch {
        toastManager.add({ title: failureTitle, type: "error" });
      }
    },
  });

  /**
   * Reset before opening, not when the form is created.
   *
   * The dialog is mounted with its trigger, so its defaults were read at page
   * load. An editor may have typed a title or picked a slug since; seeding the
   * fields on open is what makes the dialog describe the row as it is now.
   */
  const openDialog = () => {
    form.reset({
      slug: defaultSlug,
      publishedAt: toDatetimeLocalValue(defaultPublishedAt ?? new Date()),
    });
    setOpen(true);
  };

  return (
    <>
      <Button onClick={openDialog} type="button" variant="brand">
        {triggerLabel}
      </Button>
      <AlertDialog onOpenChange={setOpen} open={open}>
        <AlertDialogPopup className="max-w-md">
          <form
            className="contents"
            onSubmit={(event) => {
              event.preventDefault();
              event.stopPropagation();
              void form.handleSubmit();
            }}
          >
            <AlertDialogHeader>
              <AlertDialogTitle>{title}</AlertDialogTitle>
              <AlertDialogDescription>{description}</AlertDialogDescription>
            </AlertDialogHeader>

            <div className="space-y-4 px-6 pb-6">
              <form.AppField name="slug">
                {(field) => <field.TextField autoComplete="off" label="Slug" />}
              </form.AppField>

              <form.AppField name="publishedAt">
                {(field) => (
                  <field.TextField
                    label="Published date"
                    type="datetime-local"
                  />
                )}
              </form.AppField>
            </div>

            <AlertDialogFooter>
              <form.Subscribe selector={(state) => state.isSubmitting}>
                {(isSubmitting) => (
                  <AlertDialogCancel disabled={isSubmitting}>
                    Cancel
                  </AlertDialogCancel>
                )}
              </form.Subscribe>
              <form.AppForm>
                <form.SubscribeButton label={submitLabel} />
              </form.AppForm>
            </AlertDialogFooter>
          </form>
        </AlertDialogPopup>
      </AlertDialog>
    </>
  );
}

function toDatetimeLocalValue(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  const hours = `${date.getHours()}`.padStart(2, "0");
  const minutes = `${date.getMinutes()}`.padStart(2, "0");

  return `${year}-${month}-${day}T${hours}:${minutes}`;
}
