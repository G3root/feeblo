import { useState } from "react";
import { z } from "zod";
import { Avatar, AvatarFallback } from "~/components/ui/avatar";
import { useAppForm } from "~/hooks/form";
import { getInitials } from "../../lib/utils";

export function CommentComposer({
  autoFocus = false,
  onSubmit,
  placeholder,
  submitLabel,
  userName,
}: {
  autoFocus?: boolean;
  onSubmit: (content: string) => Promise<void>;
  placeholder: string;
  submitLabel: string;
  userName: string;
}) {
  const [submitError, setSubmitError] = useState<string | null>(null);
  const form = useAppForm({
    defaultValues: {
      content: "",
    },
    validators: {
      onSubmit: z.object({
        content: z.string().trim().min(1, "Comment is required"),
      }),
    },
    onSubmit: async ({ value }) => {
      try {
        setSubmitError(null);
        await onSubmit(value.content.trim());
        form.reset();
      } catch {
        setSubmitError("Failed to save comment. Try again.");
      }
    },
  });

  return (
    <form
      className="flex items-start gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        form.handleSubmit();
      }}
    >
      <Avatar className="mt-1 hidden sm:flex">
        <AvatarFallback>{getInitials(userName)}</AvatarFallback>
      </Avatar>
      <div className="flex-1 rounded-xl border bg-card p-3">
        <form.AppField name="content">
          {(field) => (
            <field.TextareaField
              autoFocus={autoFocus}
              className="min-h-24 resize-y border-none px-0 py-0 shadow-none focus-visible:ring-0"
              hideLabel
              label={submitLabel}
              placeholder={placeholder}
              rows={4}
            />
          )}
        </form.AppField>
        {submitError ? (
          <p className="mt-2 text-destructive text-sm">{submitError}</p>
        ) : null}
        <div className="mt-3 flex items-center justify-end">
          <form.AppForm>
            <form.SubscribeButton label={submitLabel} type="submit" />
          </form.AppForm>
        </div>
      </div>
    </form>
  );
}
