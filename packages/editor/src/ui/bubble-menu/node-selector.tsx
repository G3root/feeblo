import { Popover } from "@base-ui/react/popover";
import { useEditorState } from "@tiptap/react";
import * as React from "react";
import { EditorFocusScope } from "../editor-focus-scope";
import {
  CheckIcon,
  ChevronDownIcon,
  CodeIcon,
  Heading1Icon,
  Heading2Icon,
  Heading3Icon,
  ListIcon,
  ListOrderedIcon,
  TextIcon,
  TextQuoteIcon,
} from "../icons";
import { useBubbleMenuContext } from "./context";

export type NodeType =
  | "Text"
  | "Title"
  | "Subtitle"
  | "Heading"
  | "Bullet List"
  | "Numbered List"
  | "Quote"
  | "Code";

export interface NodeSelectorItem {
  command: () => void;
  icon: React.ComponentType<React.SVGAttributes<SVGSVGElement>>;
  isActive: boolean;
  name: NodeType;
}

interface NodeSelectorContextValue {
  activeItem: NodeSelectorItem | { name: "Multiple" };
  isOpen: boolean;
  items: NodeSelectorItem[];
  setIsOpen: (value: boolean) => void;
}

const NodeSelectorContext =
  React.createContext<NodeSelectorContextValue | null>(null);

function useNodeSelectorContext(): NodeSelectorContextValue {
  const context = React.useContext(NodeSelectorContext);
  if (!context) {
    throw new Error(
      "NodeSelector compound components must be used within <NodeSelector.Root>"
    );
  }
  return context;
}

export interface NodeSelectorRootProps {
  children: React.ReactNode;
  className?: string;
  /** Block types to exclude */
  omit?: string[];
  /** Called when open state changes */
  onOpenChange?: (open: boolean) => void;
  /** Controlled open state */
  open?: boolean;
}

export function NodeSelectorRoot({
  omit = [],
  open: controlledOpen,
  onOpenChange,
  className,
  children,
}: NodeSelectorRootProps) {
  const { editor } = useBubbleMenuContext();
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(false);

  const isControlled = controlledOpen !== undefined;
  const isOpen = isControlled ? controlledOpen : uncontrolledOpen;
  const setIsOpen = React.useCallback(
    (value: boolean) => {
      if (!isControlled) {
        setUncontrolledOpen(value);
      }
      onOpenChange?.(value);
    },
    [isControlled, onOpenChange]
  );

  const editorState = useEditorState({
    editor,
    selector: ({ editor }) => ({
      isParagraphActive:
        (editor?.isActive("paragraph") ?? false) &&
        !editor?.isActive("bulletList") &&
        !editor?.isActive("orderedList"),
      isHeading1Active: editor?.isActive("heading", { level: 1 }) ?? false,
      isHeading2Active: editor?.isActive("heading", { level: 2 }) ?? false,
      isHeading3Active: editor?.isActive("heading", { level: 3 }) ?? false,
      isBulletListActive: editor?.isActive("bulletList") ?? false,
      isOrderedListActive: editor?.isActive("orderedList") ?? false,
      isBlockquoteActive: editor?.isActive("blockquote") ?? false,
      isCodeBlockActive: editor?.isActive("codeBlock") ?? false,
    }),
  });

  const allItems: NodeSelectorItem[] = React.useMemo(
    () => [
      {
        name: "Text" as const,
        icon: TextIcon,
        command: () =>
          editor
            .chain()
            .focus()
            .clearNodes()
            .toggleNode("paragraph", "paragraph")
            .run(),
        isActive: editorState?.isParagraphActive ?? false,
      },
      {
        name: "Title" as const,
        icon: Heading1Icon,
        command: () =>
          editor.chain().focus().clearNodes().toggleHeading({ level: 1 }).run(),
        isActive: editorState?.isHeading1Active ?? false,
      },
      {
        name: "Subtitle" as const,
        icon: Heading2Icon,
        command: () =>
          editor.chain().focus().clearNodes().toggleHeading({ level: 2 }).run(),
        isActive: editorState?.isHeading2Active ?? false,
      },
      {
        name: "Heading" as const,
        icon: Heading3Icon,
        command: () =>
          editor.chain().focus().clearNodes().toggleHeading({ level: 3 }).run(),
        isActive: editorState?.isHeading3Active ?? false,
      },
      {
        name: "Bullet List" as const,
        icon: ListIcon,
        command: () =>
          editor.chain().focus().clearNodes().toggleBulletList().run(),
        isActive: editorState?.isBulletListActive ?? false,
      },
      {
        name: "Numbered List" as const,
        icon: ListOrderedIcon,
        command: () =>
          editor.chain().focus().clearNodes().toggleOrderedList().run(),
        isActive: editorState?.isOrderedListActive ?? false,
      },
      {
        name: "Quote" as const,
        icon: TextQuoteIcon,
        command: () =>
          editor
            .chain()
            .focus()
            .clearNodes()
            .toggleNode("paragraph", "paragraph")
            .toggleBlockquote()
            .run(),
        isActive: editorState?.isBlockquoteActive ?? false,
      },
      {
        name: "Code" as const,
        icon: CodeIcon,
        command: () =>
          editor.chain().focus().clearNodes().toggleCodeBlock().run(),
        isActive: editorState?.isCodeBlockActive ?? false,
      },
    ],
    [editor, editorState]
  );

  const items = React.useMemo(
    () => allItems.filter((item) => !omit.includes(item.name)),
    [allItems, omit]
  );

  const activeItem = React.useMemo(
    () =>
      items.find((item) => item.isActive) ?? {
        name: "Multiple" as const,
      },
    [items]
  );

  const contextValue = React.useMemo(
    () => ({ items, activeItem, isOpen, setIsOpen }),
    [items, activeItem, isOpen, setIsOpen]
  );

  if (!editorState || items.length === 0) {
    return null;
  }

  return (
    <NodeSelectorContext.Provider value={contextValue}>
      <Popover.Root onOpenChange={(open) => setIsOpen(open)} open={isOpen}>
        <EditorFocusScope>
          <div
            data-re-node-selector=""
            {...(isOpen ? { "data-open": "" } : {})}
            className={className}
          >
            {children}
          </div>
        </EditorFocusScope>
      </Popover.Root>
    </NodeSelectorContext.Provider>
  );
}

export interface NodeSelectorTriggerProps {
  children?: React.ReactNode;
  className?: string;
}

export function NodeSelectorTrigger({
  className,
  children,
}: NodeSelectorTriggerProps) {
  const { activeItem, isOpen, setIsOpen } = useNodeSelectorContext();

  return (
    <Popover.Trigger
      className={className}
      data-re-node-selector-trigger=""
      onClick={() => setIsOpen(!isOpen)}
    >
      {children ?? (
        <>
          <span>{activeItem.name}</span>
          <ChevronDownIcon />
        </>
      )}
    </Popover.Trigger>
  );
}

export interface NodeSelectorContentProps {
  /** Popover alignment (default: "start") */
  align?: "start" | "center" | "end";
  /** Render-prop for full control over item rendering.
   *  Receives the filtered items and a `close` function to dismiss the popover. */
  children?: (items: NodeSelectorItem[], close: () => void) => React.ReactNode;
  className?: string;
}

export function NodeSelectorContent({
  className,
  align = "start",
  children,
}: NodeSelectorContentProps) {
  const { items, setIsOpen } = useNodeSelectorContext();

  return (
    <Popover.Portal>
      <Popover.Positioner align={align} sideOffset={4}>
        <Popover.Popup className={className} data-re-node-selector-content="">
          <EditorFocusScope>
            <div>
              {children
                ? children(items, () => setIsOpen(false))
                : items.map((item) => {
                    const Icon = item.icon;
                    return (
                      <button
                        data-re-node-selector-item=""
                        key={item.name}
                        type="button"
                        {...(item.isActive ? { "data-active": "" } : {})}
                        onClick={() => {
                          item.command();
                          setIsOpen(false);
                        }}
                      >
                        <Icon />
                        <span>{item.name}</span>
                        {item.isActive && <CheckIcon />}
                      </button>
                    );
                  })}
            </div>
          </EditorFocusScope>
        </Popover.Popup>
      </Popover.Positioner>
    </Popover.Portal>
  );
}

export interface BubbleMenuNodeSelectorProps {
  className?: string;
  /** Block types to exclude */
  omit?: string[];
  /** Called when open state changes */
  onOpenChange?: (open: boolean) => void;
  /** Controlled open state */
  open?: boolean;
  /** Override the trigger content (default: active item name + chevron icon) */
  triggerContent?: React.ReactNode;
}

export function BubbleMenuNodeSelector({
  omit = [],
  className,
  triggerContent,
  open,
  onOpenChange,
}: BubbleMenuNodeSelectorProps) {
  return (
    <NodeSelectorRoot
      omit={omit}
      {...(className !== undefined ? { className } : {})}
      {...(onOpenChange !== undefined ? { onOpenChange } : {})}
      {...(open !== undefined ? { open } : {})}
    >
      <NodeSelectorTrigger>{triggerContent}</NodeSelectorTrigger>
      <NodeSelectorContent />
    </NodeSelectorRoot>
  );
}
