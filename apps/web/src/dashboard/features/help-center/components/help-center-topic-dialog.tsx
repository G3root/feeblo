import { HelpCenterTopicId } from "@feeblo/id";
import { Button } from "@feeblo/ui/button";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "@feeblo/ui/dialog";
import { useAppForm } from "@feeblo/ui/hooks/form";
import { IconPickerField } from "@feeblo/ui/icon-picker";
import { DEFAULT_HELP_CENTER_TOPIC_ICON } from "@feeblo/web-shared/icons/defaults";
import { isRpcErrorTag, parseRpcError } from "@feeblo/web-shared/rpc-error";
import * as Predicate from "effect/Predicate";
import { useState } from "react";

import { useDashboardCollections } from "~/providers/dashboard-collections-provider";

import {
  helpCenterTopicFormOptions,
  helpCenterTopicFormValues,
  type HelpCenterTopicFormValues,
} from "../help-center-forms";

/**
 * The section dialog, as two variants rather than one component with a mode.
 *
 * It used to take `topic?: {…}` — present meant edit, absent meant create — so
 * every caller had to know that a missing prop was a mode, and the body
 * branched on `isEditing` five times to say the same thing. The two components
 * below share the fields and differ in what they submit, which is the only real
 * difference between them.
 *
 * Both mount their form only while open. That is what resets it: a closed
 * dialog has no form to hold a cancelled draft, so there is no `key` to
 * remember and no effect to clear it.
 */

export function CreateHelpCenterTopicDialog({
  onOpenChange,
  open,
  organizationId,
}: {
  onOpenChange: (open: boolean) => void;
  open: boolean;
  organizationId: string;
}) {
  const { helpCenterTopicCollection } = useDashboardCollections();

  return (
    <TopicDialogFrame
      description="Sections group articles in the help center and in its URL."
      onOpenChange={onOpenChange}
      open={open}
      title="New section"
    >
      <TopicFields
        onSubmit={async (value) => {
          const id = await HelpCenterTopicId.unsafeGenerate();

          const tx = helpCenterTopicCollection.insert({
            id,
            organizationId,
            name: value.name.trim(),
            // The server derives the final slug from the name; this value is
            // the optimistic placeholder the list renders until the refetch.
            slug: value.name.trim(),
            description: value.description.trim() || null,
            icon: value.icon,
            position: 0,
            articleCount: 0,
            createdAt: new Date(),
            updatedAt: new Date(),
          });

          await tx.when("settled");
          onOpenChange(false);
        }}
        submitLabel="Create section"
      />
    </TopicDialogFrame>
  );
}

export function EditHelpCenterTopicDialog({
  onOpenChange,
  open,
  topic,
}: {
  onOpenChange: (open: boolean) => void;
  open: boolean;
  topic: {
    description: string | null;
    icon: string | null;
    id: string;
    name: string;
  };
}) {
  const { helpCenterTopicCollection } = useDashboardCollections();

  return (
    <TopicDialogFrame
      description="Renaming a section keeps its articles and its URL."
      onOpenChange={onOpenChange}
      open={open}
      title="Edit section"
    >
      <TopicFields
        initial={helpCenterTopicFormValues(topic)}
        onSubmit={async (value) => {
          const tx = helpCenterTopicCollection.update(topic.id, (current) => {
            current.name = value.name.trim();
            current.description = value.description.trim() || null;
            current.icon = value.icon;
          });

          await tx.when("settled");
          onOpenChange(false);
        }}
        submitLabel="Save section"
      />
    </TopicDialogFrame>
  );
}

/**
 * The two topic conflicts carry a slug or a count rather than a message, so the
 * generic parser cannot explain them. A slug collision is the one an editor can
 * fix in this dialog; everything else keeps the shared allowlist's copy.
 */
const topicWriteErrorMessage = (cause: unknown): string =>
  isRpcErrorTag(cause, "HelpCenterTopicSlugTakenError") ||
  Predicate.isTagged(cause, "HelpCenterTopicSlugTakenError")
    ? "That URL is already used by another section. Choose a different name."
    : parseRpcError(cause).message;

function TopicDialogFrame({
  children,
  description,
  onOpenChange,
  open,
  title,
}: {
  children: React.ReactNode;
  description: string;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  title: string;
}) {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {/* Mounted only while open, so the form's defaults are read once per
            open instead of being reset by an effect. */}
        {open ? children : null}
      </DialogPopup>
    </Dialog>
  );
}

function TopicFields({
  initial,
  onSubmit,
  submitLabel,
}: {
  initial?: HelpCenterTopicFormValues | undefined;
  onSubmit: (value: HelpCenterTopicFormValues) => Promise<void>;
  submitLabel: string;
}) {
  const [submitError, setSubmitError] = useState<string | null>(null);

  const form = useAppForm({
    ...helpCenterTopicFormOptions,
    ...(initial === undefined ? {} : { defaultValues: initial }),
    onSubmit: async ({ value }) => {
      /**
       * A refused write keeps the dialog open with the reason.
       *
       * Not a rethrow: `handleSubmit` propagates a rejected `onSubmit` to its
       * caller, and the caller is a `void form.handleSubmit()` in the submit
       * handler — so a throw is an unhandled rejection, not a message. The
       * dialog stays mounted because nothing navigates on this path.
       */
      setSubmitError(null);

      try {
        await onSubmit(value);
      } catch (cause) {
        setSubmitError(topicWriteErrorMessage(cause));
      }
    },
  });

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
      <DialogPanel className="space-y-5">
        <form.AppField name="name">
          {(field) => (
            <field.TextField
              label="Name"
              placeholder="Getting started"
              maxLength={100}
            />
          )}
        </form.AppField>

        <form.AppField name="description">
          {(field) => (
            <field.TextareaField
              label="Description"
              placeholder="What belongs in this section?"
              rows={3}
              maxLength={500}
            />
          )}
        </form.AppField>

        <form.AppField name="icon">
          {(field) => (
            <IconPickerField
              fallbackIcon={DEFAULT_HELP_CENTER_TOPIC_ICON}
              label="Choose icon"
              onChange={(icon) => field.handleChange(icon)}
              value={field.state.value}
            />
          )}
        </form.AppField>

        {submitError === null ? null : (
          <p className="text-destructive text-sm">{submitError}</p>
        )}
      </DialogPanel>

      <DialogFooter>
        <DialogClose render={<Button type="button" variant="ghost" />}>
          Cancel
        </DialogClose>
        {/* `SubscribeButton` reads the form from context, which only
            `AppForm` provides; without it it throws and the dialog's error
            boundary takes over. */}
        <form.AppForm>
          <form.SubscribeButton label={submitLabel} variant="default" />
        </form.AppForm>
      </DialogFooter>
    </form>
  );
}
