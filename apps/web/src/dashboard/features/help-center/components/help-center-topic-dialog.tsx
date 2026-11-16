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
import { Field, FieldLabel } from "@feeblo/ui/field";
import { Input } from "@feeblo/ui/input";
import { Textarea } from "@feeblo/ui/textarea";
import { cn } from "@feeblo/ui/utils";
import { useState } from "react";

import { useDashboardCollections } from "~/providers/dashboard-collections-provider";

import {
  DEFAULT_HELP_CENTER_TOPIC_ICON,
  HELP_CENTER_TOPIC_ICON_KEYS,
  HelpCenterTopicIcon,
  isHelpCenterTopicIcon,
  type THelpCenterTopicIcon,
} from "./help-center-topic-icons";

export type THelpCenterTopicDraft = {
  description: string;
  icon: THelpCenterTopicIcon;
  name: string;
};

const emptyDraft = (): THelpCenterTopicDraft => ({
  description: "",
  icon: DEFAULT_HELP_CENTER_TOPIC_ICON,
  name: "",
});

/**
 * The create and rename dialog for a topic.
 *
 * One component for both because the fields are identical and the difference is
 * only whether the save is an insert or an update. The slug is not a field: the
 * server derives it from the name, and an editor who wants a different URL gets
 * one by renaming rather than by maintaining a separate key by hand.
 */
export function HelpCenterTopicDialog({
  organizationId,
  onOpenChange,
  open,
  topic,
}: {
  organizationId: string;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  topic?:
    | {
        description: string | null;
        icon: string | null;
        id: string;
        name: string;
      }
    | undefined;
}) {
  const { helpCenterTopicCollection } = useDashboardCollections();
  const [draft, setDraft] = useState<THelpCenterTopicDraft>(emptyDraft);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isEditing = topic !== undefined;

  // The dialog is remounted per open, so the draft is seeded from the row being
  // edited rather than reset by an effect that would also clobber typing.
  const [seededFor, setSeededFor] = useState<string | null>(null);
  const seedKey = topic?.id ?? "new";

  if (open && seededFor !== seedKey) {
    setSeededFor(seedKey);
    setDraft(
      isEditing
        ? {
            description: topic.description ?? "",
            icon: isHelpCenterTopicIcon(topic.icon)
              ? topic.icon
              : DEFAULT_HELP_CENTER_TOPIC_ICON,
            name: topic.name,
          }
        : emptyDraft()
    );
  }

  if (!open && seededFor !== null) {
    setSeededFor(null);
  }

  const submit = async () => {
    const name = draft.name.trim();

    if (name.length === 0) {
      setError("A section needs a name.");

      return;
    }

    setPending(true);
    setError(null);

    try {
      const description =
        draft.description.trim().length === 0 ? null : draft.description.trim();

      if (isEditing) {
        helpCenterTopicCollection.update(topic.id, (current) => {
          current.name = name;
          current.description = description;
          current.icon = draft.icon;
        });
      } else {
        const id = await HelpCenterTopicId.unsafeGenerate();

        helpCenterTopicCollection.insert({
          id,
          organizationId,
          name,
          // The server derives the slug from the name; this value is the
          // optimistic placeholder the list renders until the refetch lands.
          slug: name,
          description,
          icon: draft.icon,
          position: 0,
          articleCount: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }

      onOpenChange(false);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not save the section."
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>
            {isEditing ? "Edit section" : "New section"}
          </DialogTitle>
          <DialogDescription>
            Sections group articles in the help center and in its URL.
          </DialogDescription>
        </DialogHeader>

        <DialogPanel className="space-y-5">
          <Field>
            <FieldLabel htmlFor="help-center-topic-name">Name</FieldLabel>
            <Input
              id="help-center-topic-name"
              maxLength={100}
              onChange={(event) =>
                setDraft((prev) => ({ ...prev, name: event.target.value }))
              }
              placeholder="Getting started"
              value={draft.name}
            />
          </Field>

          <Field>
            <FieldLabel htmlFor="help-center-topic-description">
              Description
            </FieldLabel>
            <Textarea
              id="help-center-topic-description"
              maxLength={500}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  description: event.target.value,
                }))
              }
              placeholder="What belongs in this section?"
              rows={3}
              value={draft.description}
            />
          </Field>

          <Field>
            <FieldLabel>Icon</FieldLabel>
            <div className="flex flex-wrap gap-2">
              {HELP_CENTER_TOPIC_ICON_KEYS.map((key) => (
                <button
                  aria-label={key}
                  aria-pressed={draft.icon === key}
                  className={cn(
                    "flex size-9 items-center justify-center rounded-md border transition-colors",
                    draft.icon === key
                      ? "border-primary/50 bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                  key={key}
                  onClick={() => setDraft((prev) => ({ ...prev, icon: key }))}
                  type="button"
                >
                  <HelpCenterTopicIcon className="size-4" icon={key} />
                </button>
              ))}
            </div>
          </Field>

          {error === null ? null : (
            <p className="text-destructive text-sm">{error}</p>
          )}
        </DialogPanel>

        <DialogFooter>
          <DialogClose render={<Button type="button" variant="ghost" />}>
            Cancel
          </DialogClose>
          <Button disabled={pending} onClick={submit} type="button">
            {isEditing ? "Save section" : "Create section"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
