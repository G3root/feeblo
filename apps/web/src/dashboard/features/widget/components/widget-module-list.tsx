import { KeyboardSensor, PointerSensor } from "@dnd-kit/dom";
import { type DragDropEventHandlers, DragDropProvider } from "@dnd-kit/react";
import { isSortable, useSortable } from "@dnd-kit/react/sortable";
import type { WidgetModule } from "@feeblo/feedback-widget/config";
import { Badge } from "@feeblo/ui/badge";
import { Switch } from "@feeblo/ui/switch";
import { cn } from "@feeblo/ui/utils";
import {
  DragDropVerticalIcon,
  Megaphone01Icon,
  MessageMultiple01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type HugeiconsIconProps } from "@hugeicons/react";
import { useCallback } from "react";

import { WIDGET_MODULE_LABELS } from "../lib/widget-config";

interface ModuleDetails {
  description: string;
  icon: HugeiconsIconProps["icon"];
  label: string;
}

const WIDGET_MODULE_DETAILS = {
  feedback: {
    description: "A public board where visitors post ideas and vote on them.",
    icon: MessageMultiple01Icon,
    label: WIDGET_MODULE_LABELS.feedback,
  },
  updates: {
    description: "Your published changelog as a feed of product updates.",
    icon: Megaphone01Icon,
    label: WIDGET_MODULE_LABELS.updates,
  },
} as const satisfies Record<WidgetModule, ModuleDetails>;

/** The drag starts from the handle only, so rows stay clickable. */
const sensors = [
  PointerSensor.configure({
    activatorElements(source) {
      return [source.handle];
    },
  }),
  KeyboardSensor,
];

interface WidgetModuleListProps {
  /** Modules in display order, with their enabled state. */
  modules: { enabled: boolean; id: WidgetModule }[];
  onMove: (from: number, to: number) => void;
  onToggle: (module: WidgetModule) => void;
}

/**
 * The list is the widget's tab order: rows keep every module, and the switch
 * decides which ones the widget ships with. A disabled row stays in place so
 * re-enabling it puts the module back where the author left it.
 */
export function WidgetModuleList({
  modules,
  onMove,
  onToggle,
}: WidgetModuleListProps) {
  const enabledCount = modules.filter((module) => module.enabled).length;
  const firstEnabledId = modules.find((module) => module.enabled)?.id;

  const handleDragEnd = useCallback<DragDropEventHandlers["onDragEnd"]>(
    (event) => {
      if (event.canceled) {
        return;
      }
      const { source } = event.operation;
      // The sortable plugin reorders as the pointer moves and writes the
      // destination into the source's own `index`; at drop time `target` is
      // the source again, so the two indices are the whole answer.
      if (!source || !isSortable(source)) {
        return;
      }
      if (source.initialIndex !== source.index) {
        onMove(source.initialIndex, source.index);
      }
    },
    [onMove]
  );

  return (
    <DragDropProvider onDragEnd={handleDragEnd} sensors={sensors}>
      <div className="flex flex-col gap-2">
        {modules.map((module, index) => (
          <WidgetModuleRow
            canDisable={enabledCount > 1}
            entry={module}
            index={index}
            isFirstEnabled={module.id === firstEnabledId}
            key={module.id}
            onToggle={onToggle}
            showOpensFirst={enabledCount > 1}
          />
        ))}
      </div>
    </DragDropProvider>
  );
}

interface WidgetModuleRowProps {
  canDisable: boolean;
  entry: { enabled: boolean; id: WidgetModule };
  index: number;
  isFirstEnabled: boolean;
  onToggle: (module: WidgetModule) => void;
  showOpensFirst: boolean;
}

function WidgetModuleRow({
  canDisable,
  entry,
  index,
  isFirstEnabled,
  onToggle,
  showOpensFirst,
}: WidgetModuleRowProps) {
  const { handleRef, isDragging, ref } = useSortable({
    id: entry.id,
    index,
  });
  const details = WIDGET_MODULE_DETAILS[entry.id];

  return (
    <div
      className={cn(
        "bg-card flex items-center gap-3 rounded-xl border px-3 py-3 transition-colors",
        isDragging && "z-10 shadow-lg",
        entry.enabled ? undefined : "opacity-64"
      )}
      ref={ref}
    >
      <button
        aria-label={`Reorder ${details.label}`}
        className="text-muted-foreground/70 hover:text-foreground -ml-1 cursor-grab touch-none rounded-md p-1 transition-colors active:cursor-grabbing"
        ref={handleRef}
        type="button"
      >
        <HugeiconsIcon className="size-4" icon={DragDropVerticalIcon} />
      </button>
      <span className="bg-muted text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-lg">
        <HugeiconsIcon className="size-4" icon={details.icon} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{details.label}</span>
          {showOpensFirst && isFirstEnabled ? (
            <Badge size="sm" variant="secondary">
              Opens first
            </Badge>
          ) : null}
        </div>
        <p className="text-muted-foreground mt-0.5 text-xs">
          {details.description}
        </p>
      </div>
      <Switch
        aria-label={`${entry.enabled ? "Hide" : "Show"} ${details.label} module`}
        checked={entry.enabled}
        disabled={entry.enabled && !canDisable}
        onCheckedChange={() => onToggle(entry.id)}
      />
    </div>
  );
}
