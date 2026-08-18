import type { Uploader } from "prosekit/extensions/file";
import type { ImageExtension } from "prosekit/extensions/image";
import { useEditor } from "prosekit/react";
import {
  PopoverPopup,
  PopoverPositioner,
  PopoverRoot,
  PopoverTrigger,
} from "prosekit/react/popover";
import type { OpenChangeEvent } from "prosekit/web/popover";
import { type ReactNode, useId, useState } from "react";

import { Button } from "../button/index";

export default function ImageUploadPopover(props: {
  uploader: Uploader<string>;
  tooltip: string;
  disabled: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const ariaId = useId();

  const editor = useEditor<ImageExtension>();

  const handleFileChange: React.ChangeEventHandler<HTMLInputElement> = (
    event
  ) => {
    const file = event.target.files?.[0];

    if (file) {
      setFile(file);
      setUrl("");
    } else {
      setFile(null);
    }
  };

  const handleUrlChange: React.ChangeEventHandler<HTMLInputElement> = (
    event
  ) => {
    const url = event.target.value;

    if (url) {
      setUrl(url);
      setFile(null);
    } else {
      setUrl("");
    }
  };

  const deferResetState = () => {
    setTimeout(() => {
      setUrl("");
      setFile(null);
    }, 300);
  };

  const handleSubmit = () => {
    if (url) {
      editor.commands.insertImage({ src: url });
    } else if (file) {
      editor.commands.uploadImage({ file, uploader: props.uploader });
    }
    setOpen(false);
    deferResetState();
  };

  const handleOpenChange = (event: OpenChangeEvent) => {
    if (!event.detail) {
      deferResetState();
    }
    setOpen(event.detail);
  };

  return (
    <PopoverRoot onOpenChange={handleOpenChange} open={open}>
      <PopoverTrigger>
        <Button
          disabled={props.disabled}
          pressed={open}
          tooltip={props.tooltip}
        >
          {props.children}
        </Button>
      </PopoverTrigger>

      <PopoverPositioner
        className="z-50 block h-min w-min overflow-visible transition-transform duration-100 ease-out motion-reduce:transition-none"
        placement="bottom"
      >
        <PopoverPopup className="border-border bg-popover text-popover-foreground box-border flex w-sm origin-(--transform-origin) flex-col gap-y-4 rounded-xl border p-6 text-sm shadow-lg transition-[opacity,scale] transition-discrete duration-40 data-[state=closed]:scale-95 data-[state=closed]:opacity-0 data-[state=closed]:duration-150 motion-reduce:transition-none starting:scale-95 starting:opacity-0">
          {file ? null : (
            <>
              <label htmlFor={`id-link-${ariaId}`}>Embed Link</label>
              <input
                className="border-input bg-background placeholder:text-muted-foreground focus-visible:ring-ring box-border flex h-9 w-full rounded-md border border-solid px-3 py-2 text-sm ring-0 ring-transparent outline-hidden transition file:border-0 file:bg-transparent file:text-sm file:font-medium focus-visible:ring-2 focus-visible:ring-offset-0 focus-visible:outline-hidden disabled:cursor-not-allowed disabled:opacity-50"
                id={`id-link-${ariaId}`}
                onChange={handleUrlChange}
                placeholder="Paste the image link..."
                type="url"
                value={url}
              />
            </>
          )}

          {url ? null : (
            <>
              <label htmlFor={`id-upload-${ariaId}`}>Upload</label>
              <input
                accept="image/*"
                className="border-input bg-background placeholder:text-muted-foreground focus-visible:ring-ring box-border flex h-9 w-full rounded-md border border-solid px-3 py-2 text-sm ring-0 ring-transparent outline-hidden transition file:border-0 file:bg-transparent file:text-sm file:font-medium focus-visible:ring-2 focus-visible:ring-offset-0 focus-visible:outline-hidden disabled:cursor-not-allowed disabled:opacity-50"
                id={`id-upload-${ariaId}`}
                onChange={handleFileChange}
                type="file"
              />
            </>
          )}

          {url ? (
            <button
              className="bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:ring-ring inline-flex h-10 w-full items-center justify-center rounded-md border-0 px-4 py-2 text-sm font-medium whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-hidden disabled:pointer-events-none disabled:opacity-50"
              onClick={handleSubmit}
            >
              Insert Image
            </button>
          ) : null}

          {file ? (
            <button
              className="bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:ring-ring inline-flex h-10 w-full items-center justify-center rounded-md border-0 px-4 py-2 text-sm font-medium whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-hidden disabled:pointer-events-none disabled:opacity-50"
              onClick={handleSubmit}
            >
              Upload Image
            </button>
          ) : null}
        </PopoverPopup>
      </PopoverPositioner>
    </PopoverRoot>
  );
}
