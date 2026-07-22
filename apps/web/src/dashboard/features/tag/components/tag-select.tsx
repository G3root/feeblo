import { Button } from "@feeblo/ui/button";
import {
  Combobox,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
} from "@feeblo/ui/combobox";
import {
  Cancel01Icon,
  PlusSignIcon,
  Search01Icon,
  Tag01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useState } from "react";
import { useTagCreateDialogContext } from "../dialog-stores";

export interface TagSelectOption {
  id: string;
  name: string;
  type: "FEEDBACK" | "CHANGELOG";
}

export interface SelectedTag {
  id: string;
  tagId: string;
  typeId: string;
}

interface TagSelectProps {
  disabled?: boolean;
  onTagSelect: (
    option: TagSelectOption,
    isSelected: boolean
  ) => void | Promise<void>;
  selectedTags: SelectedTag[];
  tags: TagSelectOption[];
  type: TagSelectOption["type"];
}

export function TagSelect({
  disabled = false,
  onTagSelect,
  selectedTags,
  tags,
  type,
}: TagSelectProps) {
  const [open, setOpen] = useState(false);
  const createDialogStore = useTagCreateDialogContext();
  const selectedTagIds = new Set(selectedTags.map((tag) => tag.tagId));
  const selected = tags.filter((tag) => selectedTagIds.has(tag.id));

  const updateSelection = async (nextSelected: TagSelectOption[]) => {
    const nextTagIds = new Set(nextSelected.map((tag) => tag.id));
    const changedTag = tags.find(
      (tag) => selectedTagIds.has(tag.id) !== nextTagIds.has(tag.id)
    );

    if (!changedTag) {
      return;
    }

    await onTagSelect(changedTag, selectedTagIds.has(changedTag.id));
    setOpen(false);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <Combobox
            autoHighlight
            disabled={disabled}
            items={tags}
            multiple
            onOpenChange={setOpen}
            onValueChange={updateSelection}
            open={open}
            value={selected}
          >
            <ComboboxInput
              aria-label="Add tags"
              placeholder="Add tags..."
              size="sm"
              startAddon={
                <HugeiconsIcon icon={Search01Icon} strokeWidth={2} />
              }
            />
            <ComboboxPopup aria-label="Select tags">
              <ComboboxEmpty>No tags found.</ComboboxEmpty>
              <ComboboxList>
                {(tag) => (
                  <ComboboxItem key={tag.id} value={tag}>
                    <span className="flex items-center gap-2 whitespace-nowrap">
                      <HugeiconsIcon icon={Tag01Icon} strokeWidth={2} />
                      {tag.name}
                    </span>
                  </ComboboxItem>
                )}
              </ComboboxList>
            </ComboboxPopup>
          </Combobox>
        </div>
        <Button
          aria-label="Create tag"
          disabled={disabled}
          onClick={() =>
            createDialogStore.send({ type: "toggle", data: { type } })
          }
          size="icon-sm"
          variant="outline"
        >
          <HugeiconsIcon icon={PlusSignIcon} />
        </Button>
      </div>

      {selected.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5">
          {selected.map((tag) => (
            <li
              className="flex min-w-0 items-center gap-1 rounded-md border border-input bg-background py-0.5 ps-2 pe-0.5 text-sm"
              key={tag.id}
            >
              <HugeiconsIcon
                className="size-3.5 shrink-0 text-muted-foreground"
                icon={Tag01Icon}
              />
              <span className="truncate font-medium">{tag.name}</span>
              <Button
                aria-label={`Remove ${tag.name}`}
                disabled={disabled}
                onClick={() => onTagSelect(tag, true)}
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
