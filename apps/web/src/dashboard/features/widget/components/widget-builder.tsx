import {
  CardFrame,
  CardFrameDescription,
  CardFrameHeader,
  CardFrameTitle,
} from "@feeblo/ui/card";
import { Field, FieldDescription, FieldLabel } from "@feeblo/ui/field";
import { ToggleGroup, ToggleGroupItem } from "@feeblo/ui/toggle-group";
import {
  ArrowDownLeft01Icon,
  ArrowDownRight01Icon,
  CursorPointer01Icon,
  Moon02Icon,
  Sun03Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { Dispatch } from "react";

import {
  describeWidgetLauncher,
  isWidgetLauncher,
  isWidgetTheme,
  type WidgetDraft,
  type WidgetDraftAction,
  type WidgetLauncher,
  type WidgetTheme,
} from "../lib/widget-config";
import { WidgetModuleList } from "./widget-module-list";

const LAUNCHER_OPTIONS = [
  { icon: ArrowDownRight01Icon, label: "Right", value: "bottom-right" },
  { icon: ArrowDownLeft01Icon, label: "Left", value: "bottom-left" },
  { icon: CursorPointer01Icon, label: "Hidden", value: "none" },
] as const satisfies readonly {
  icon: typeof ArrowDownRight01Icon;
  label: string;
  value: WidgetLauncher;
}[];

const THEME_OPTIONS = [
  { icon: Sun03Icon, label: "Light", value: "light" },
  { icon: Moon02Icon, label: "Dark", value: "dark" },
] as const satisfies readonly {
  icon: typeof Sun03Icon;
  label: string;
  value: WidgetTheme;
}[];

interface WidgetBuilderProps {
  dispatch: Dispatch<WidgetDraftAction>;
  draft: WidgetDraft;
}

/** The left column: what the widget contains and how it appears. */
export function WidgetBuilder({ dispatch, draft }: WidgetBuilderProps) {
  return (
    <div className="flex flex-col gap-4">
      <WidgetModulesCard dispatch={dispatch} draft={draft} />
      <WidgetLauncherCard dispatch={dispatch} draft={draft} />
    </div>
  );
}

function WidgetModulesCard({ dispatch, draft }: WidgetBuilderProps) {
  return (
    <CardFrame>
      <CardFrameHeader>
        <CardFrameTitle>Modules</CardFrameTitle>
        <CardFrameDescription>
          What visitors can do in the widget. Drag to reorder — the first
          enabled module is what opens.
        </CardFrameDescription>
      </CardFrameHeader>
      <div className="px-6 pb-5">
        <WidgetModuleList
          modules={draft.modules}
          onMove={(from, to) => dispatch({ type: "moveModule", from, to })}
          onToggle={(module) => dispatch({ type: "toggleModule", module })}
        />
        <p className="text-muted-foreground mt-3 text-xs">
          Two modules become a hub with tabs; one module opens on its own. At
          least one module is required.
        </p>
      </div>
    </CardFrame>
  );
}

function WidgetLauncherCard({ dispatch, draft }: WidgetBuilderProps) {
  return (
    <CardFrame>
      <CardFrameHeader>
        <CardFrameTitle>Launcher</CardFrameTitle>
        <CardFrameDescription>
          How visitors open the widget, and which theme it renders in.
        </CardFrameDescription>
      </CardFrameHeader>
      <div className="flex flex-col gap-5 px-6 pb-5">
        <Field>
          <FieldLabel>Position</FieldLabel>
          <ToggleGroup
            multiple={false}
            onValueChange={(value) => {
              const next = value[0];
              if (next !== undefined && isWidgetLauncher(next)) {
                dispatch({ type: "setLauncher", launcher: next });
              }
            }}
            value={[draft.launcher]}
            variant="outline"
          >
            {LAUNCHER_OPTIONS.map((option) => (
              <ToggleGroupItem
                aria-label={option.label}
                key={option.value}
                value={option.value}
              >
                <HugeiconsIcon icon={option.icon} />
                {option.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <FieldDescription>
            {describeWidgetLauncher(draft.launcher)}
          </FieldDescription>
        </Field>
        <Field>
          <FieldLabel>Theme</FieldLabel>
          <ToggleGroup
            multiple={false}
            onValueChange={(value) => {
              const next = value[0];
              if (next !== undefined && isWidgetTheme(next)) {
                dispatch({ type: "setTheme", theme: next });
              }
            }}
            value={[draft.theme]}
            variant="outline"
          >
            {THEME_OPTIONS.map((option) => (
              <ToggleGroupItem
                aria-label={option.label}
                key={option.value}
                value={option.value}
              >
                <HugeiconsIcon icon={option.icon} />
                {option.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <FieldDescription>
            The theme the widget ships with on your site.
          </FieldDescription>
        </Field>
      </div>
    </CardFrame>
  );
}
