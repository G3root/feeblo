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
import { Input } from "@feeblo/ui/input";
import { Label } from "@feeblo/ui/label";
import { toastManager } from "@feeblo/ui/toast";
import { useState } from "react";
import { publishChangelogSchema } from "../schema";

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
  const [slug, setSlug] = useState(defaultSlug);
  const [publishedAt, setPublishedAt] = useState(
    toDatetimeLocalValue(defaultPublishedAt ?? new Date())
  );
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit() {
    const parsed = publishChangelogSchema.safeParse({ publishedAt, slug });

    if (!parsed.success) {
      toastManager.add({
        title: parsed.error.issues[0]?.message ?? "Invalid publish settings",
        type: "error",
      });
      return;
    }

    try {
      setIsSubmitting(true);
      await onPublish({
        publishedAt: new Date(parsed.data.publishedAt),
        slug: parsed.data.slug,
      });
      setOpen(false);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <>
      <Button onClick={() => setOpen(true)} type="button">
        {triggerLabel}
      </Button>
      <AlertDialog onOpenChange={setOpen} open={open}>
        <AlertDialogPopup className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>Save changelog</AlertDialogTitle>
            <AlertDialogDescription>
              Choose the public URL and publication date for this changelog.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-4 px-6 pb-6">
            <div className="space-y-2">
              <Label htmlFor="changelog-slug">Slug</Label>
              <Input
                autoComplete="off"
                id="changelog-slug"
                onChange={(event) => setSlug(event.target.value)}
                type="text"
                value={slug}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="published-at">Published date</Label>
              <Input
                id="published-at"
                onChange={(event) => setPublishedAt(event.target.value)}
                type="datetime-local"
                value={publishedAt}
              />
            </div>
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={isSubmitting}>Cancel</AlertDialogCancel>
            <Button
              disabled={isSubmitting}
              onClick={handleSubmit}
              type="button"
            >
              Save
            </Button>
          </AlertDialogFooter>
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
