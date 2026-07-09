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
        <BlockHandlePopup className="box-border flex origin-(--transform-origin) starting:scale-95 starting:opacity-0 transition-[opacity,scale] transition-discrete duration-100 data-[state=closed]:scale-95 data-[state=closed]:opacity-0 data-[state=closed]:duration-150 motion-reduce:transition-none">
          <BlockHandleAdd className="box-border flex h-6 w-6 cursor-pointer items-center justify-center rounded-sm text-muted-foreground/50 hover:bg-accent hover:text-accent-foreground">
            <div className="i-lucide-plus block size-5" />
          </BlockHandleAdd>
          <BlockHandleDraggable className="box-border flex h-6 w-5 cursor-grab items-center justify-center rounded-sm text-muted-foreground/50 hover:bg-accent hover:text-accent-foreground">
            <div className="i-lucide-grip-vertical block size-5" />
          </BlockHandleDraggable>
        </BlockHandlePopup>
      </BlockHandlePositioner>
    </BlockHandleRoot>
  );
}
