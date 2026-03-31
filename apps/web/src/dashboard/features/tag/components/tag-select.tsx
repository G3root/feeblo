import { PlusSignIcon, Tag01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "~/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "~/components/ui/popover";

export const TagSelect = Popover;

export const TagSelectTrigger = () => (
  <PopoverTrigger
    render={
      <Button size="icon-xs" variant="outline">
        <HugeiconsIcon icon={PlusSignIcon} />
      </Button>
    }
  />
);

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

interface TagSelectContentProps {
  onTagSelect: (option: TagSelectOption, isSelected: boolean) => void;
  selectedTags: SelectedTag[];
  tags: TagSelectOption[];
}

export const TagSelectContent = ({
  tags,
  selectedTags,
  onTagSelect,
}: TagSelectContentProps) => {
  const selectedTagIds = new Set(selectedTags.map((tag) => tag.tagId));
  return (
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
                  onSelect={() => onTagSelect(tag, isSelected)}
                  value={tag.name}
                >
                  <Checkbox checked={isSelected} />
                  {tag.name}
                </CommandItem>
              );
            })}
          </CommandGroup>
        </CommandList>
      </Command>
    </PopoverContent>
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
  return (
    <div className="flex flex-wrap gap-2">
      {selectedTags.map((tag) => (
        <Badge key={tag.id} variant="secondary">
          <HugeiconsIcon data-icon="inline-start" icon={Tag01Icon} />
          {tagIdToNameMap.get(tag.tagId) || "Unknown Tag"}
        </Badge>
      ))}
    </div>
  );
};
