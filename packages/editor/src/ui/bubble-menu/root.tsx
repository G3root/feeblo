import { PluginKey } from "@tiptap/pm/state";
import { useCurrentEditor, useEditorState } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import * as React from "react";
import { EditorFocusScope } from "../editor-focus-scope";
import { BubbleMenuAlignCenter } from "./align-center";
import { BubbleMenuAlignLeft } from "./align-left";
import { BubbleMenuAlignRight } from "./align-right";
import { BubbleMenuBold } from "./bold";
import { BubbleMenuCode } from "./code";
import { BubbleMenuContext } from "./context";
import { BubbleMenuItemGroup } from "./group";
import { BubbleMenuItalic } from "./italic";
import { BubbleMenuLinkSelector } from "./link-selector";
import { BubbleMenuNodeSelector } from "./node-selector";
import { BubbleMenuStrike } from "./strike";
import { bubbleMenuTriggers, type TriggerFn } from "./triggers";
import { BubbleMenuUnderline } from "./underline";
import { BubbleMenuUppercase } from "./uppercase";

const defaultPluginKey = new PluginKey("bubbleMenu");

export interface BubbleMenuRootProps
  extends React.ComponentPropsWithoutRef<"div"> {
  hideWhenActiveMarks?: string[];
  hideWhenActiveNodes?: string[];
  offset?: number;
  onHide?: () => void;
  placement?: "top" | "bottom";
  pluginKey?: PluginKey;
  trigger?: TriggerFn;
}

function Root({
  trigger,
  pluginKey = defaultPluginKey,
  hideWhenActiveNodes = [],
  hideWhenActiveMarks = [],
  placement = "bottom",
  offset = 8,
  onHide,
  className,
  children,
  ...rest
}: BubbleMenuRootProps) {
  const { editor } = useCurrentEditor();
  const [isEditing, setIsEditing] = React.useState(false);

  const resolvedTrigger =
    trigger ??
    bubbleMenuTriggers.textSelection(hideWhenActiveNodes, hideWhenActiveMarks);

  if (!editor) {
    return null;
  }

  return (
    <EditorFocusScope>
      <BubbleMenu
        className={className}
        data-re-bubble-menu=""
        editor={editor}
        options={{
          placement,
          offset,
          onHide: () => {
            setIsEditing(false);
            onHide?.();
          },
        }}
        pluginKey={pluginKey}
        shouldShow={resolvedTrigger}
        {...rest}
      >
        <BubbleMenuContext.Provider value={{ editor, isEditing, setIsEditing }}>
          {children}
        </BubbleMenuContext.Provider>
      </BubbleMenu>
    </EditorFocusScope>
  );
}

const textPluginKey = new PluginKey("textBubbleMenu");

interface BubbleMenuDefaultProps
  extends Omit<React.ComponentPropsWithoutRef<"div">, "children"> {
  hideWhenActiveMarks?: string[];
  hideWhenActiveNodes?: string[];
  offset?: number;
  onHide?: () => void;
  placement?: "top" | "bottom";
}

function Default({
  hideWhenActiveNodes,
  hideWhenActiveMarks,
  placement,
  offset,
  onHide,
  className,
  ...rest
}: BubbleMenuDefaultProps) {
  const [isNodeSelectorOpen, setIsNodeSelectorOpen] = React.useState(false);
  const [isLinkSelectorOpen, setIsLinkSelectorOpen] = React.useState(false);
  const { editor } = useCurrentEditor();

  const isCodeActive = useEditorState({
    editor,
    selector: ({ editor: e }) => e?.isActive("code") ?? false,
  });

  const handleNodeSelectorOpenChange = React.useCallback((open: boolean) => {
    setIsNodeSelectorOpen(open);
    if (open) {
      setIsLinkSelectorOpen(false);
    }
  }, []);

  const handleLinkSelectorOpenChange = React.useCallback((open: boolean) => {
    setIsLinkSelectorOpen(open);
    if (open) {
      setIsNodeSelectorOpen(false);
    }
  }, []);

  const handleHide = React.useCallback(() => {
    setIsNodeSelectorOpen(false);
    setIsLinkSelectorOpen(false);
    onHide?.();
  }, [onHide]);

  return (
    <Root
      className={className}
      hideWhenActiveMarks={hideWhenActiveMarks}
      hideWhenActiveNodes={hideWhenActiveNodes}
      offset={offset}
      onHide={handleHide}
      placement={placement}
      pluginKey={textPluginKey}
      {...rest}
    >
      {isCodeActive ? (
        <>
          <BubbleMenuNodeSelector
            onOpenChange={handleNodeSelectorOpenChange}
            open={isNodeSelectorOpen}
          />
          <BubbleMenuCode />
        </>
      ) : (
        <>
          <BubbleMenuNodeSelector
            onOpenChange={handleNodeSelectorOpenChange}
            open={isNodeSelectorOpen}
          />
          <BubbleMenuLinkSelector
            onOpenChange={handleLinkSelectorOpenChange}
            open={isLinkSelectorOpen}
          />
          <BubbleMenuItemGroup>
            <BubbleMenuBold />
            <BubbleMenuItalic />
            <BubbleMenuUnderline />
            <BubbleMenuStrike />
            <BubbleMenuCode />
            <BubbleMenuUppercase />
          </BubbleMenuItemGroup>
          <BubbleMenuItemGroup>
            <BubbleMenuAlignLeft />
            <BubbleMenuAlignCenter />
            <BubbleMenuAlignRight />
          </BubbleMenuItemGroup>
        </>
      )}
    </Root>
  );
}

function RootWithDefault({ children, ...rest }: BubbleMenuRootProps) {
  if (children) {
    return <Root {...rest}>{children}</Root>;
  }

  return <Default {...rest} />;
}

export { RootWithDefault as BubbleMenuRoot };
