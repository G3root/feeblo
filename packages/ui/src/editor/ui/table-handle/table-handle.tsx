import type { Editor } from "prosekit/core";
import type { TableExtension } from "prosekit/extensions/table";
import { useEditorDerivedValue } from "prosekit/react";
import { MenuItem, MenuPopup, MenuPositioner } from "prosekit/react/menu";
import {
  TableHandleColumnMenuRoot,
  TableHandleColumnMenuTrigger,
  TableHandleColumnPopup,
  TableHandleColumnPositioner,
  TableHandleDragPreview,
  TableHandleDropIndicator,
  TableHandleRoot,
  TableHandleRowMenuRoot,
  TableHandleRowMenuTrigger,
  TableHandleRowPopup,
  TableHandleRowPositioner,
} from "prosekit/react/table-handle";

function getTableHandleState(editor: Editor<TableExtension>) {
  return {
    addTableColumnBefore: {
      canExec: editor.commands.addTableColumnBefore.canExec(),
      command: () => editor.commands.addTableColumnBefore(),
    },
    addTableColumnAfter: {
      canExec: editor.commands.addTableColumnAfter.canExec(),
      command: () => editor.commands.addTableColumnAfter(),
    },
    deleteCellSelection: {
      canExec: editor.commands.deleteCellSelection.canExec(),
      command: () => editor.commands.deleteCellSelection(),
    },
    deleteTableColumn: {
      canExec: editor.commands.deleteTableColumn.canExec(),
      command: () => editor.commands.deleteTableColumn(),
    },
    addTableRowAbove: {
      canExec: editor.commands.addTableRowAbove.canExec(),
      command: () => editor.commands.addTableRowAbove(),
    },
    addTableRowBelow: {
      canExec: editor.commands.addTableRowBelow.canExec(),
      command: () => editor.commands.addTableRowBelow(),
    },
    deleteTableRow: {
      canExec: editor.commands.deleteTableRow.canExec(),
      command: () => editor.commands.deleteTableRow(),
    },
    deleteTable: {
      canExec: editor.commands.deleteTable.canExec(),
      command: () => editor.commands.deleteTable(),
    },
  };
}

interface Props {
  dir?: "ltr" | "rtl";
}

export default function TableHandle(props: Props) {
  const state = useEditorDerivedValue(getTableHandleState);

  return (
    <TableHandleRoot>
      <TableHandleDragPreview />
      <TableHandleDropIndicator />
      <TableHandleColumnPositioner className="z-50 block h-min w-min overflow-visible transition-transform duration-100 ease-out motion-reduce:transition-none">
        <TableHandleColumnPopup className="box-border flex origin-(--transform-origin) translate-y-[50%] starting:scale-95 starting:opacity-0 transition-[opacity,scale] transition-discrete duration-100 data-[state=closed]:scale-95 data-[state=closed]:opacity-0 data-[state=closed]:duration-150 motion-reduce:transition-none">
          <TableHandleColumnMenuRoot>
            <TableHandleColumnMenuTrigger className="box-border flex h-4.5 w-6 items-center justify-center overflow-clip rounded-sm border border-border border-solid bg-background p-0 text-muted-foreground/50 transition-colors hover:bg-accent hover:text-accent-foreground">
              <div className="i-lucide-grip-horizontal block size-5 min-h-5 min-w-5" />
            </TableHandleColumnMenuTrigger>
            <MenuPositioner className="z-50 block h-min w-min overflow-visible transition-transform duration-100 ease-out motion-reduce:transition-none">
              <MenuPopup className="relative box-border flex max-h-100 min-w-32 origin-(--transform-origin) starting:scale-95 select-none flex-col overflow-auto whitespace-nowrap rounded-xl border border-border bg-popover p-1 text-popover-foreground starting:opacity-0 shadow-lg outline-none transition-[opacity,scale] transition-discrete duration-40 data-[state=closed]:scale-95 data-[state=closed]:opacity-0 data-[state=closed]:duration-150 motion-reduce:transition-none">
                {state.addTableColumnBefore.canExec && (
                  <MenuItem
                    className="relative box-border flex min-w-32 cursor-default select-none scroll-my-1 items-center justify-between gap-8 whitespace-nowrap rounded-sm px-3 py-1.5 outline-hidden data-[disabled=true]:pointer-events-none data-highlighted:bg-accent data-danger:text-destructive data-highlighted:text-accent-foreground data-[disabled=true]:opacity-50 hover:data-[disabled=true]:opacity-50"
                    onSelect={state.addTableColumnBefore.command}
                  >
                    <span>Insert Left</span>
                  </MenuItem>
                )}
                {state.addTableColumnAfter.canExec && (
                  <MenuItem
                    className="relative box-border flex min-w-32 cursor-default select-none scroll-my-1 items-center justify-between gap-8 whitespace-nowrap rounded-sm px-3 py-1.5 outline-hidden data-[disabled=true]:pointer-events-none data-highlighted:bg-accent data-danger:text-destructive data-highlighted:text-accent-foreground data-[disabled=true]:opacity-50 hover:data-[disabled=true]:opacity-50"
                    onSelect={state.addTableColumnAfter.command}
                  >
                    <span>Insert Right</span>
                  </MenuItem>
                )}
                {state.deleteCellSelection.canExec && (
                  <MenuItem
                    className="relative box-border flex min-w-32 cursor-default select-none scroll-my-1 items-center justify-between gap-8 whitespace-nowrap rounded-sm px-3 py-1.5 outline-hidden data-[disabled=true]:pointer-events-none data-highlighted:bg-accent data-danger:text-destructive data-highlighted:text-accent-foreground data-[disabled=true]:opacity-50 hover:data-[disabled=true]:opacity-50"
                    onSelect={state.deleteCellSelection.command}
                  >
                    <span>Clear Contents</span>
                    <span className="text-muted-foreground text-xs tracking-widest">
                      Del
                    </span>
                  </MenuItem>
                )}
                {state.deleteTableColumn.canExec && (
                  <MenuItem
                    className="relative box-border flex min-w-32 cursor-default select-none scroll-my-1 items-center justify-between gap-8 whitespace-nowrap rounded-sm px-3 py-1.5 outline-hidden data-[disabled=true]:pointer-events-none data-highlighted:bg-accent data-danger:text-destructive data-highlighted:text-accent-foreground data-[disabled=true]:opacity-50 hover:data-[disabled=true]:opacity-50"
                    onSelect={state.deleteTableColumn.command}
                  >
                    <span>Delete Column</span>
                  </MenuItem>
                )}
                {state.deleteTable.canExec && (
                  <MenuItem
                    className="relative box-border flex min-w-32 cursor-default select-none scroll-my-1 items-center justify-between gap-8 whitespace-nowrap rounded-sm px-3 py-1.5 outline-hidden data-[disabled=true]:pointer-events-none data-highlighted:bg-accent data-danger:text-destructive data-highlighted:text-accent-foreground data-[disabled=true]:opacity-50 hover:data-[disabled=true]:opacity-50"
                    data-danger=""
                    onSelect={state.deleteTable.command}
                  >
                    <span>Delete Table</span>
                  </MenuItem>
                )}
              </MenuPopup>
            </MenuPositioner>
          </TableHandleColumnMenuRoot>
        </TableHandleColumnPopup>
      </TableHandleColumnPositioner>
      <TableHandleRowPositioner
        className="z-50 block h-min w-min overflow-visible transition-transform duration-100 ease-out motion-reduce:transition-none"
        placement={props.dir === "rtl" ? "right" : "left"}
      >
        <TableHandleRowPopup className="box-border flex origin-(--transform-origin) starting:scale-95 starting:opacity-0 transition-[opacity,scale] transition-discrete duration-100 data-[state=closed]:scale-95 data-[state=closed]:opacity-0 data-[state=closed]:duration-150 motion-reduce:transition-none ltr:translate-x-[50%] rtl:translate-x-[-50%]">
          <TableHandleRowMenuRoot>
            <TableHandleRowMenuTrigger className="box-border flex h-6 w-4.5 items-center justify-center overflow-clip rounded-sm border border-border border-solid bg-background p-0 text-muted-foreground/50 transition-colors hover:bg-accent hover:text-accent-foreground">
              <div className="i-lucide-grip-vertical block size-5 min-h-5 min-w-5" />
            </TableHandleRowMenuTrigger>
            <MenuPositioner className="z-50 block h-min w-min overflow-visible transition-transform duration-100 ease-out motion-reduce:transition-none">
              <MenuPopup className="relative box-border flex max-h-100 min-w-32 origin-(--transform-origin) starting:scale-95 select-none flex-col overflow-auto whitespace-nowrap rounded-xl border border-border bg-popover p-1 text-popover-foreground starting:opacity-0 shadow-lg outline-none transition-[opacity,scale] transition-discrete duration-40 data-[state=closed]:scale-95 data-[state=closed]:opacity-0 data-[state=closed]:duration-150 motion-reduce:transition-none">
                {state.addTableRowAbove.canExec && (
                  <MenuItem
                    className="relative box-border flex min-w-32 cursor-default select-none scroll-my-1 items-center justify-between gap-8 whitespace-nowrap rounded-sm px-3 py-1.5 outline-hidden data-[disabled=true]:pointer-events-none data-highlighted:bg-accent data-danger:text-destructive data-highlighted:text-accent-foreground data-[disabled=true]:opacity-50 hover:data-[disabled=true]:opacity-50"
                    onSelect={state.addTableRowAbove.command}
                  >
                    <span>Insert Above</span>
                  </MenuItem>
                )}
                {state.addTableRowBelow.canExec && (
                  <MenuItem
                    className="relative box-border flex min-w-32 cursor-default select-none scroll-my-1 items-center justify-between gap-8 whitespace-nowrap rounded-sm px-3 py-1.5 outline-hidden data-[disabled=true]:pointer-events-none data-highlighted:bg-accent data-danger:text-destructive data-highlighted:text-accent-foreground data-[disabled=true]:opacity-50 hover:data-[disabled=true]:opacity-50"
                    onSelect={state.addTableRowBelow.command}
                  >
                    <span>Insert Below</span>
                  </MenuItem>
                )}
                {state.deleteCellSelection.canExec && (
                  <MenuItem
                    className="relative box-border flex min-w-32 cursor-default select-none scroll-my-1 items-center justify-between gap-8 whitespace-nowrap rounded-sm px-3 py-1.5 outline-hidden data-[disabled=true]:pointer-events-none data-highlighted:bg-accent data-danger:text-destructive data-highlighted:text-accent-foreground data-[disabled=true]:opacity-50 hover:data-[disabled=true]:opacity-50"
                    onSelect={state.deleteCellSelection.command}
                  >
                    <span>Clear Contents</span>
                    <span className="text-muted-foreground text-xs tracking-widest">
                      Del
                    </span>
                  </MenuItem>
                )}
                {state.deleteTableRow.canExec && (
                  <MenuItem
                    className="relative box-border flex min-w-32 cursor-default select-none scroll-my-1 items-center justify-between gap-8 whitespace-nowrap rounded-sm px-3 py-1.5 outline-hidden data-[disabled=true]:pointer-events-none data-highlighted:bg-accent data-danger:text-destructive data-highlighted:text-accent-foreground data-[disabled=true]:opacity-50 hover:data-[disabled=true]:opacity-50"
                    onSelect={state.deleteTableRow.command}
                  >
                    <span>Delete Row</span>
                  </MenuItem>
                )}
                {state.deleteTable.canExec && (
                  <MenuItem
                    className="relative box-border flex min-w-32 cursor-default select-none scroll-my-1 items-center justify-between gap-8 whitespace-nowrap rounded-sm px-3 py-1.5 outline-hidden data-[disabled=true]:pointer-events-none data-highlighted:bg-accent data-danger:text-destructive data-highlighted:text-accent-foreground data-[disabled=true]:opacity-50 hover:data-[disabled=true]:opacity-50"
                    data-danger=""
                    onSelect={state.deleteTable.command}
                  >
                    <span>Delete Table</span>
                  </MenuItem>
                )}
              </MenuPopup>
            </MenuPositioner>
          </TableHandleRowMenuRoot>
        </TableHandleRowPopup>
      </TableHandleRowPositioner>
    </TableHandleRoot>
  );
}
