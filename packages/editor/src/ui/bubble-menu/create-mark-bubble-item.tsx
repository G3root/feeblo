import { useEditorState } from "@tiptap/react";
import type * as React from "react";
import { useBubbleMenuContext } from "./context";
import { BubbleMenuItem } from "./item";

export interface PreWiredItemProps {
  /** Override the default icon */
  children?: React.ReactNode;
  className?: string;
}

interface MarkBubbleItemConfig {
  activeName: string;
  activeParams?: Record<string, unknown>;
  command: string;
  icon: React.ReactNode;
  name: string;
}

export function createMarkBubbleItem(config: MarkBubbleItemConfig) {
  function MarkBubbleItem({ className, children }: PreWiredItemProps) {
    const { editor } = useBubbleMenuContext();

    const isActive = useEditorState({
      editor,
      selector: ({ editor }) => {
        if (config.activeParams) {
          return (
            editor?.isActive(config.activeName, config.activeParams) ?? false
          );
        }
        return editor?.isActive(config.activeName) ?? false;
      },
    });

    const handleCommand = () => {
      const chain = editor.chain().focus();
      const method = (chain as unknown as Record<string, () => typeof chain>)[
        config.command
      ];
      if (method) {
        method.call(chain).run();
      }
    };

    return (
      <BubbleMenuItem
        className={className}
        isActive={isActive}
        name={config.name}
        onCommand={handleCommand}
      >
        {children ?? config.icon}
      </BubbleMenuItem>
    );
  }

  MarkBubbleItem.displayName = `BubbleMenu${config.name.charAt(0).toUpperCase() + config.name.slice(1)}`;

  return MarkBubbleItem;
}
