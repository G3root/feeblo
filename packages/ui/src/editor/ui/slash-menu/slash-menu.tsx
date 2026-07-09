import type { BasicExtension } from "prosekit/basic";
import { canUseRegexLookbehind } from "prosekit/core";
import { useEditor } from "prosekit/react";
import {
  AutocompletePopup,
  AutocompletePositioner,
  AutocompleteRoot,
} from "prosekit/react/autocomplete";
import { type ChangeEvent, useRef } from "react";
import { editorUploader } from "../../uploader";
import SlashMenuEmpty from "./slash-menu-empty";
import SlashMenuItem from "./slash-menu-item";

// Match inputs like "/", "/table", "/heading 1" etc. Do not match "/ heading".
const regex = canUseRegexLookbehind() ? /(?<!\S)\/(\S.*)?$/u : /\/(\S.*)?$/u;

export default function SlashMenu() {
  const editor = useEditor<BasicExtension>();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImageSelect = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    editor.commands.uploadImage({ file, uploader: editorUploader });

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  return (
    <>
      <input
        accept="image/*"
        className="hidden"
        onChange={handleFileChange}
        ref={fileInputRef}
        type="file"
      />
      <AutocompleteRoot regex={regex}>
        <AutocompletePositioner className="z-50 block h-min w-min overflow-visible transition-transform duration-100 ease-out motion-reduce:transition-none">
          <AutocompletePopup className="relative box-border flex max-h-100 min-h-0 min-w-60 origin-(--transform-origin) starting:scale-95 select-none flex-col overflow-hidden whitespace-nowrap rounded-xl border border-border bg-popover text-popover-foreground starting:opacity-0 shadow-lg transition-[opacity,scale] transition-discrete duration-40 data-[state=closed]:scale-95 data-[state=closed]:opacity-0 data-[state=closed]:duration-150 motion-reduce:transition-none">
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain p-1">
              <SlashMenuItem
                label="Text"
                onSelect={() => editor.commands.setParagraph()}
              />

              <SlashMenuItem
                kbd="#"
                label="Heading 1"
                onSelect={() => editor.commands.setHeading({ level: 1 })}
              />

              <SlashMenuItem
                kbd="##"
                label="Heading 2"
                onSelect={() => editor.commands.setHeading({ level: 2 })}
              />

              <SlashMenuItem
                kbd="###"
                label="Heading 3"
                onSelect={() => editor.commands.setHeading({ level: 3 })}
              />

              <SlashMenuItem
                kbd="-"
                label="Bullet list"
                onSelect={() => editor.commands.wrapInList({ kind: "bullet" })}
              />

              <SlashMenuItem
                kbd="1."
                label="Ordered list"
                onSelect={() => editor.commands.wrapInList({ kind: "ordered" })}
              />

              <SlashMenuItem
                kbd="[]"
                label="Task list"
                onSelect={() => editor.commands.wrapInList({ kind: "task" })}
              />

              <SlashMenuItem
                kbd=">>"
                label="Toggle list"
                onSelect={() => editor.commands.wrapInList({ kind: "toggle" })}
              />

              <SlashMenuItem
                kbd=">"
                label="Quote"
                onSelect={() => editor.commands.setBlockquote()}
              />

              <SlashMenuItem
                label="Table"
                onSelect={() => editor.commands.insertTable({ row: 3, col: 3 })}
              />

              <SlashMenuItem
                kbd="---"
                label="Divider"
                onSelect={() => editor.commands.insertHorizontalRule()}
              />

              <SlashMenuItem
                kbd="```"
                label="Code"
                onSelect={() => editor.commands.setCodeBlock()}
              />

              <SlashMenuItem
                kbd="img"
                label="Image"
                onSelect={handleImageSelect}
              />

              <SlashMenuEmpty />
            </div>
          </AutocompletePopup>
        </AutocompletePositioner>
      </AutocompleteRoot>
    </>
  );
}
