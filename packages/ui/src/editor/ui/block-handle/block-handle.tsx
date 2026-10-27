import { GripVerticalIcon, PlusSignIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  BlockHandleAdd,
  BlockHandleDraggable,
  BlockHandlePopup,
  BlockHandlePositioner,
  BlockHandleRoot,
} from "prosekit/react/block-handle";

interface Props {
  dir?: "ltr" | "rtl";
}

export default function BlockHandle(props: Props) {
  return (
    <BlockHandleRoot>
      <BlockHandlePositioner
        className="z-50 block h-min w-min overflow-visible transition-transform duration-100 ease-out motion-reduce:transition-none"
        placement={props.dir === "rtl" ? "right" : "left"}
      >
        <BlockHandlePopup className="box-border flex origin-(--transform-origin) transition-[opacity,scale] transition-discrete duration-100 data-[state=closed]:scale-95 data-[state=closed]:opacity-0 data-[state=closed]:duration-150 motion-reduce:transition-none starting:scale-95 starting:opacity-0">
          <BlockHandleAdd className="text-muted-foreground/50 hover:bg-accent hover:text-accent-foreground box-border flex h-6 w-6 cursor-pointer items-center justify-center rounded-sm">
            <HugeiconsIcon
              aria-hidden="true"
              className="size-5"
              icon={PlusSignIcon}
            />
          </BlockHandleAdd>
          <BlockHandleDraggable className="text-muted-foreground/50 hover:bg-accent hover:text-accent-foreground box-border flex h-6 w-5 cursor-grab items-center justify-center rounded-sm">
            <HugeiconsIcon
              aria-hidden="true"
              className="size-5"
              icon={GripVerticalIcon}
            />
          </BlockHandleDraggable>
        </BlockHandlePopup>
      </BlockHandlePositioner>
    </BlockHandleRoot>
  );
}
