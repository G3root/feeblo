import { useState } from "react";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { RadioGroup, RadioGroupItem } from "~/components/ui/radio-group";
import { toastManager } from "~/components/ui/toast";
import type { ChangelogStatus } from "../constants";
import {
  publishChangelogSchema,
  type TPublishChangelogValues,
} from "../schema";

export function ChangelogPublishDialog({
  defaultScheduledAt,
  currentStatus,
  onPublishNow,
  onScheduleLater,
  triggerLabel = "Save",
}: {
  defaultScheduledAt: Date | null;
  currentStatus: ChangelogStatus;
  onPublishNow: () => Promise<void>;
  onScheduleLater: (scheduledAt: Date) => Promise<void>;
  triggerLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] =
    useState<TPublishChangelogValues["mode"]>("publish-now");
  const [scheduledAt, setScheduledAt] = useState(
    defaultScheduledAt ? toDatetimeLocalValue(defaultScheduledAt) : ""
  );
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit() {
    const parsed = publishChangelogSchema.safeParse({
      mode,
      scheduledAt,
    });

    if (!parsed.success) {
      toastManager.add({
        title: parsed.error.issues[0]?.message ?? "Invalid publish settings",
        type: "error",
      });
      return;
    }

    try {
      setIsSubmitting(true);

      if (parsed.data.mode === "publish-now") {
        await onPublishNow();
      } else {
        await onScheduleLater(new Date(parsed.data.scheduledAt!));
      }

      setOpen(false);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <>
      <Button
        onClick={() => {
          if (currentStatus === "published") {
            setMode("publish-now");
          }
          setOpen(true);
        }}
        type="button"
      >
        {triggerLabel}
      </Button>
      <Dialog onOpenChange={setOpen} open={open}>
        <DialogPopup className="max-w-md">
          <DialogHeader>
            <DialogTitle>Save changelog</DialogTitle>
            <DialogDescription>
              {currentStatus === "published"
                ? "This changelog is already published. You can publish updates immediately."
                : "Publish immediately or schedule this changelog for a later time."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 px-6 pb-2">
            <RadioGroup
              className="space-y-3"
              onValueChange={(value) =>
                setMode(value as TPublishChangelogValues["mode"])
              }
              value={mode}
            >
              <label
                className="flex items-start gap-3 rounded-xl border p-4"
                htmlFor="publish-now"
              >
                <RadioGroupItem id="publish-now" value="publish-now" />
                <div className="space-y-1">
                  <p className="font-medium text-sm">Publish now</p>
                  <p className="text-muted-foreground text-sm">
                    Make this update visible immediately.
                  </p>
                </div>
              </label>

              {currentStatus !== "published" ? (
                <label
                  className="flex items-start gap-3 rounded-xl border p-4"
                  htmlFor="schedule-later"
                >
                  <RadioGroupItem id="schedule-later" value="schedule-later" />
                  <div className="space-y-1">
                    <p className="font-medium text-sm">Publish later</p>
                    <p className="text-muted-foreground text-sm">
                      Pick a future date and time for this release note.
                    </p>
                  </div>
                </label>
              ) : null}
            </RadioGroup>

            {currentStatus !== "published" && mode === "schedule-later" ? (
              <div className="space-y-2">
                <Label htmlFor="scheduled-at">Publish date</Label>
                <Input
                  id="scheduled-at"
                  onChange={(event) => setScheduledAt(event.target.value)}
                  type="datetime-local"
                  value={scheduledAt}
                />
              </div>
            ) : null}
          </div>

          <DialogFooter>
            <Button
              onClick={() => setOpen(false)}
              type="button"
              variant="outline"
            >
              Cancel
            </Button>
            <Button
              disabled={isSubmitting}
              onClick={handleSubmit}
              type="button"
            >
              {mode === "publish-now" ? "Publish now" : "Schedule"}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
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
