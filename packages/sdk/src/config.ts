import { EmbedError } from "./errors";
import type { WidgetMode, WidgetModule, WidgetPlacement } from "./types";

const DEFAULT_MODULES: WidgetModule[] = ["feedback", "updates"];
// The lookup sets accept `PropertyKey` because `normalizeWidgetConfig`
// validates values from plain-JavaScript callers: a Symbol must reach
// `invalidConfig` as `INVALID_CONFIG` instead of throwing a coercion TypeError.
const MODES: ReadonlySet<PropertyKey> = new Set<WidgetMode>([
  "feedback",
  "updates",
  "hub",
]);
const MODULES = new Set<WidgetModule>(DEFAULT_MODULES);
const PLACEMENTS: ReadonlySet<PropertyKey> = new Set<WidgetPlacement>([
  "bottom-left",
  "bottom-right",
]);

export interface NormalizedWidgetConfig {
  mode: WidgetMode;
  modules: WidgetModule[];
  placement?: WidgetPlacement | undefined;
}

function invalidConfig(message: string): never {
  throw new EmbedError({ code: "INVALID_CONFIG", message });
}

function isWidgetMode(value: PropertyKey): value is WidgetMode {
  return MODES.has(value);
}

function isWidgetPlacement(value: PropertyKey): value is WidgetPlacement {
  return PLACEMENTS.has(value);
}

function parseMode(value: PropertyKey): WidgetMode {
  if (!isWidgetMode(value)) {
    invalidConfig(`[feeblo-sdk] Invalid widget mode: ${String(value)}.`);
  }
  return value;
}

function parsePlacement(value: PropertyKey): WidgetPlacement {
  if (!isWidgetPlacement(value)) {
    invalidConfig(`[feeblo-sdk] Invalid widget placement: ${String(value)}.`);
  }
  return value;
}

export function normalizeWidgetConfig(options: {
  mode?: PropertyKey | undefined;
  modules?: WidgetModule[] | undefined;
  placement?: PropertyKey | undefined;
}): NormalizedWidgetConfig {
  const mode = parseMode(options.mode ?? "feedback");
  const placement = options.placement
    ? parsePlacement(options.placement)
    : undefined;

  if (mode !== "hub" && options.modules !== undefined) {
    invalidConfig("[feeblo-sdk] `modules` can only be used with mode `hub`.");
  }

  const modules =
    mode === "hub" ? (options.modules ?? DEFAULT_MODULES) : [mode];
  if (modules.length === 0) {
    invalidConfig("[feeblo-sdk] Hub must enable at least one module.");
  }
  if (modules.some((module) => !MODULES.has(module))) {
    invalidConfig("[feeblo-sdk] Hub modules must be `feedback` or `updates`.");
  }
  if (new Set(modules).size !== modules.length) {
    invalidConfig("[feeblo-sdk] Hub modules cannot contain duplicates.");
  }

  return {
    mode,
    modules: [...modules],
    ...(placement !== undefined && { placement }),
  };
}

/**
 * Whether board selection is supported for this config. Board selection is
 * intentionally limited to configs whose landing module is `feedback`: the
 * landing module is `modules[0]` (the initially active module), and the widget
 * only applies board selection while the feedback module is active.
 */
export function supportsBoardSelection(
  config: NormalizedWidgetConfig
): boolean {
  return config.modules[0] === "feedback";
}

export function widgetConfigKey(config: NormalizedWidgetConfig): string {
  return `${config.mode}:${config.modules.join(",")}:${config.placement ?? "trigger"}`;
}
