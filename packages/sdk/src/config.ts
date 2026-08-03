import { EmbedError } from "./errors";
import type {
  EmbedOptions,
  WidgetMode,
  WidgetModule,
  WidgetPlacement,
} from "./types";

const DEFAULT_MODULES: WidgetModule[] = ["feedback", "updates"];
const MODES = new Set<WidgetMode>(["feedback", "updates", "hub"]);
const MODULES = new Set<WidgetModule>(DEFAULT_MODULES);
const PLACEMENTS = new Set<WidgetPlacement>(["bottom-left", "bottom-right"]);

export interface NormalizedWidgetConfig {
  mode: WidgetMode;
  modules: WidgetModule[];
  placement?: WidgetPlacement | undefined;
}

function invalidConfig(message: string): never {
  throw new EmbedError({ code: "INVALID_CONFIG", message });
}

export function normalizeWidgetConfig(
  options: Pick<EmbedOptions, "mode" | "modules" | "placement">
): NormalizedWidgetConfig {
  const mode = options.mode ?? "feedback";
  if (!MODES.has(mode)) {
    invalidConfig(`[feeblo-sdk] Invalid widget mode: ${String(mode)}.`);
  }
  if (options.placement && !PLACEMENTS.has(options.placement)) {
    invalidConfig(
      `[feeblo-sdk] Invalid widget placement: ${String(options.placement)}.`
    );
  }

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
    ...(options.placement ? { placement: options.placement } : {}),
  };
}

export function widgetConfigKey(config: NormalizedWidgetConfig): string {
  return `${config.mode}:${config.modules.join(",")}:${config.placement ?? "trigger"}`;
}
