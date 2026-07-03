import { Badge } from "@feeblo/ui/badge";
import { Button } from "@feeblo/ui/button";
import { Checkbox } from "@feeblo/ui/checkbox";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@feeblo/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@feeblo/ui/popover";
import { PlusSignIcon, Tag01Icon } from "@hugeicons/core-free-icons";
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

export const TagSelect = ({
  tags,
  selectedTags,
  onTagSelect,
  type,
  disabled = false,
}: TagSelectProps) => {
  const [open, setOpen] = useState(false);
  const createDialogStore = useTagCreateDialogContext();
  const selectedTagIds = new Set(selectedTags.map((tag) => tag.tagId));
  const hasSelectedTags = selectedTags.length > 0;
  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger
        render={
          <Button
            disabled={disabled}
            size={hasSelectedTags ? "icon-xs" : "xs"}
            variant="ghost"
          >
            {hasSelectedTags ? (
              <HugeiconsIcon icon={PlusSignIcon} />
            ) : (
              <>
                <HugeiconsIcon icon={Tag01Icon} /> Add Tag
              </>
            )}
          </Button>
        }
      />
      <PopoverContent align="start" className="w-50 p-0">
        <Command>
          <CommandInput />
          <CommandList className="max-h-full">
            <CommandEmpty>No results found.</CommandEmpty>
            <CommandGroup className="max-h-75 scroll-py-1 overflow-y-auto overflow-x-hidden">
              {tags.map((tag) => {
                const isSelected = selectedTagIds.has(tag.id);

                return (
                  <CommandItem
                    key={tag.id}
                    onSelect={async () => {
                      setOpen(false);
                      await onTagSelect(tag, isSelected);
                    }}
                    value={tag.name}
                  >
                    <Checkbox checked={isSelected} />
                    {tag.name}
                  </CommandItem>
                );
              })}
            </CommandGroup>
            <CommandSeparator />
            <CommandGroup>
              <CommandItem
                onSelect={() => {
                  setOpen(false);
                  createDialogStore.send({ type: "toggle", data: { type } });
                }}
                value="create tag"
              >
                <HugeiconsIcon icon={PlusSignIcon} />
                Create tag
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
};

export const TagList = ({
  tags,
  selectedTags,
}: {
  tags: TagSelectOption[];
  selectedTags: SelectedTag[];
}) => {
  const tagIdToNameMap = new Map(tags.map((tag) => [tag.id, tag.name]));
  return selectedTags.map((tag) => (
    <Badge key={tag.id} variant="secondary">
      <HugeiconsIcon data-icon="inline-start" icon={Tag01Icon} />
      {tagIdToNameMap.get(tag.tagId) || "Unknown Tag"}
    </Badge>
  ));
};
