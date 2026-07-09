import type { BasicExtension } from "prosekit/basic";
import type { Union } from "prosekit/core";
import type { MentionExtension } from "prosekit/extensions/mention";
import { useEditor } from "prosekit/react";
import {
  AutocompleteEmpty,
  AutocompleteItem,
  AutocompletePopup,
  AutocompletePositioner,
  AutocompleteRoot,
} from "prosekit/react/autocomplete";

const regex = /#[\da-z]*$/i;

export default function TagMenu(props: {
  tags: { id: number; label: string }[];
}) {
  const editor = useEditor<Union<[MentionExtension, BasicExtension]>>();

  const handleTagInsert = (id: number, label: string) => {
    editor.commands.insertMention({
      id: id.toString(),
      value: "#" + label,
      kind: "tag",
    });
    editor.commands.insertText({ text: " " });
  };

  return (
    <AutocompleteRoot regex={regex}>
      <AutocompletePositioner className="z-50 block h-min w-min overflow-visible transition-transform duration-100 ease-out motion-reduce:transition-none">
        <AutocompletePopup className="relative box-border flex max-h-100 min-h-0 min-w-60 origin-(--transform-origin) starting:scale-95 select-none flex-col overflow-hidden whitespace-nowrap rounded-xl border border-border bg-popover text-popover-foreground starting:opacity-0 shadow-lg transition-[opacity,scale] transition-discrete duration-40 data-[state=closed]:scale-95 data-[state=closed]:opacity-0 data-[state=closed]:duration-150 motion-reduce:transition-none">
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain p-1">
            <AutocompleteEmpty className="relative box-border flex min-w-32 cursor-default select-none scroll-my-1 items-center justify-between whitespace-nowrap rounded-md px-3 py-1.5 text-sm outline-hidden data-highlighted:bg-accent data-highlighted:text-accent-foreground">
              No results
            </AutocompleteEmpty>

            {props.tags.map((tag) => (
              <AutocompleteItem
                className="relative box-border flex min-w-32 cursor-default select-none scroll-my-1 items-center justify-between whitespace-nowrap rounded-md px-3 py-1.5 text-sm outline-hidden data-highlighted:bg-accent data-highlighted:text-accent-foreground"
                key={tag.id}
                onSelect={() => handleTagInsert(tag.id, tag.label)}
              >
                #{tag.label}
              </AutocompleteItem>
            ))}
          </div>
        </AutocompletePopup>
      </AutocompletePositioner>
    </AutocompleteRoot>
  );
}
