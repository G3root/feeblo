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
import { useSelector } from "@xstate/store-react";

import {
  describeWidgetLauncher,
  isWidgetLauncher,
  isWidgetTheme,
  type WidgetLauncher,
  type WidgetTheme,
} from "../lib/widget-config";
import { useWidgetStore } from "../lib/widget-store";
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

/** The left column: what the widget contains and how it appears. */
export function WidgetBuilder() {
  return (
    <div className="flex flex-col gap-4">
      <WidgetModulesCard />
      <WidgetLauncherCard />
    </div>
  );
}

function WidgetModulesCard() {
  const store = useWidgetStore();
  const modules = useSelector(
    store,
    (snapshot) => snapshot.context.draft.modules
  );

  return (
    <CardFrame>
      <CardFrameHeader>
        <CardFrameTitle>Modules</CardFrameTitle>
        <CardFrameDescription>
          What visitors can do in the widget. Drag to reorder; the module you
          put first opens by default.
        </CardFrameDescription>
      </CardFrameHeader>
      <div className="px-6 pb-5">
        <WidgetModuleList
          modules={modules}
          onMove={(from, to) => store.send({ type: "moveModule", from, to })}
          onToggle={(module) => store.send({ type: "toggleModule", module })}
        />
        <p className="text-muted-foreground mt-3 text-xs">
          Two enabled modules become a hub with tabs; a single module opens
          directly. At least one module must stay enabled.
        </p>
      </div>
    </CardFrame>
  );
}

function WidgetLauncherCard() {
  const store = useWidgetStore();
  const launcher = useSelector(
    store,
    (snapshot) => snapshot.context.draft.launcher
  );
  const theme = useSelector(store, (snapshot) => snapshot.context.draft.theme);

  return (
    <CardFrame>
      <CardFrameHeader>
        <CardFrameTitle>Launcher</CardFrameTitle>
        <CardFrameDescription>
          How visitors open the widget and the theme it renders in.
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
                store.send({ type: "setLauncher", launcher: next });
              }
            }}
            value={[launcher]}
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
            {describeWidgetLauncher(launcher)}
          </FieldDescription>
        </Field>
        <Field>
          <FieldLabel>Theme</FieldLabel>
          <ToggleGroup
            multiple={false}
            onValueChange={(value) => {
              const next = value[0];
              if (next !== undefined && isWidgetTheme(next)) {
                store.send({ type: "setTheme", theme: next });
              }
            }}
            value={[theme]}
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
