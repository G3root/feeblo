import type { BasicExtension } from "prosekit/basic";
import { canUseRegexLookbehind, type Union } from "prosekit/core";
import type { MentionExtension } from "prosekit/extensions/mention";
import { useEditor } from "prosekit/react";
import {
  AutocompleteEmpty,
  AutocompleteItem,
  AutocompletePopup,
  AutocompletePositioner,
  AutocompleteRoot,
} from "prosekit/react/autocomplete";

// Match inputs like "@", "@foo", "@foo bar" etc. Do not match "@ foo".
const regex = canUseRegexLookbehind() ? /(?<!\S)@(\S.*)?$/u : /@(\S.*)?$/u;

export default function UserMenu(props: {
  users: { id: number; name: string }[];
  loading?: boolean;
  onQueryChange?: (query: string) => void;
  onOpenChange?: (open: boolean) => void;
}) {
  const editor = useEditor<Union<[MentionExtension, BasicExtension]>>();

  const handleUserInsert = (id: number, username: string) => {
    editor.commands.insertMention({
      id: id.toString(),
      value: "@" + username,
      kind: "user",
    });
    editor.commands.insertText({ text: " " });
  };

  return (
    <AutocompleteRoot
      onOpenChange={(event) => props.onOpenChange?.(event.detail)}
      onQueryChange={(event) => props.onQueryChange?.(event.detail)}
      regex={regex}
    >
      <AutocompletePositioner className="z-50 block h-min w-min overflow-visible transition-transform duration-100 ease-out motion-reduce:transition-none">
        <AutocompletePopup className="relative box-border flex max-h-100 min-h-0 min-w-60 origin-(--transform-origin) starting:scale-95 select-none flex-col overflow-hidden whitespace-nowrap rounded-xl border border-border bg-popover text-popover-foreground starting:opacity-0 shadow-lg transition-[opacity,scale] transition-discrete duration-40 data-[state=closed]:scale-95 data-[state=closed]:opacity-0 data-[state=closed]:duration-150 motion-reduce:transition-none">
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain p-1">
            <AutocompleteEmpty className="relative box-border flex min-w-32 cursor-default select-none scroll-my-1 items-center justify-between whitespace-nowrap rounded-md px-3 py-1.5 text-sm outline-hidden data-highlighted:bg-accent data-highlighted:text-accent-foreground">
              {props.loading ? "Loading..." : "No results"}
            </AutocompleteEmpty>

            {props.users.map((user) => (
              <AutocompleteItem
                className="relative box-border flex min-w-32 cursor-default select-none scroll-my-1 items-center justify-between whitespace-nowrap rounded-md px-3 py-1.5 text-sm outline-hidden data-highlighted:bg-accent data-highlighted:text-accent-foreground"
                key={user.id}
                onSelect={() => handleUserInsert(user.id, user.name)}
              >
                <span className={props.loading ? "opacity-50" : undefined}>
                  {user.name}
                </span>
              </AutocompleteItem>
            ))}
          </div>
        </AutocompletePopup>
      </AutocompletePositioner>
    </AutocompleteRoot>
  );
}
