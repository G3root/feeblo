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
import { publishChangelogFormOpts } from "../shared-form";

export function ChangelogPublishDialog({
  defaultPublishedAt,
  defaultSlug,
  onPublish,
  triggerLabel = "Save",
}: {
  defaultPublishedAt: Date | null;
  defaultSlug: string;
  onPublish: (values: { publishedAt: Date; slug: string }) => Promise<void>;
  triggerLabel?: string;
}) {
  const [open, setOpen] = useState(false);

  const form = useAppForm({
    ...publishChangelogFormOpts,
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
      } catch (_error) {
        toastManager.add({
          title: "Failed to publish changelog",
          type: "error",
        });
      }
    },
  });

  return (
    <>
      <Button onClick={() => setOpen(true)} type="button" variant="brand">
        {triggerLabel}
      </Button>
      <AlertDialog onOpenChange={setOpen} open={open}>
        <AlertDialogPopup className="max-w-md">
          <form
            className="contents"
            onSubmit={(e) => {
              e.preventDefault();
              e.stopPropagation();
              form.handleSubmit();
            }}
          >
            <AlertDialogHeader>
              <AlertDialogTitle>Save changelog</AlertDialogTitle>
              <AlertDialogDescription>
                Choose the public URL and publication date for this changelog.
              </AlertDialogDescription>
            </AlertDialogHeader>

            <div className="space-y-4 px-6 pb-6">
              <form.AppField
                children={(field) => (
                  <field.TextField autoComplete="off" label="Slug" />
                )}
                name="slug"
              />

              <form.AppField
                children={(field) => (
                  <field.TextField
                    label="Published date"
                    type="datetime-local"
                  />
                )}
                name="publishedAt"
              />
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
                <form.SubscribeButton label="Save" />
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
