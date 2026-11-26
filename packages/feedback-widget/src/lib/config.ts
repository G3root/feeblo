/**
 * The widget's surfaces.
 *
 * `help` reads the workspace's published help center — the same documentation
 * the portal serves — and is dropped at runtime when that surface does not
 * exist for the workspace.
 */
export type WidgetModule = "feedback" | "updates" | "help";

export type WidgetMode = WidgetModule | "hub";

export const SUPPORTED_LOCALES = ["en"] as const;

export type WidgetLocale = (typeof SUPPORTED_LOCALES)[number];

export function isSupportedLocale(value: string | null): value is WidgetLocale {
  // SAFETY: The runtime invariant checked by the surrounding code guarantees this type.
  return value !== null && SUPPORTED_LOCALES.includes(value as WidgetLocale);
}

export interface WidgetConfig {
  mode: WidgetMode;
  modules: WidgetModule[];
}

const fallback: WidgetConfig = { mode: "feedback", modules: ["feedback"] };

export function getWidgetConfig(): WidgetConfig {
  const config =
    // SAFETY: The runtime invariant checked by the surrounding code guarantees this type.
    (
      window as typeof window & {
        global?: { __ENV?: { widgetConfig?: WidgetConfig } };
      }
    ).global?.__ENV?.widgetConfig;

  return config ?? fallback;
}

export function moduleForPath(pathname: string): WidgetModule {
  if (pathname.startsWith("/updates")) {
    return "updates";
  }

  if (pathname.startsWith("/help")) {
    return "help";
  }

  return "feedback";
}

/** Where each module's surface starts, for a parent that switches modules. */
export const modulePaths = {
  feedback: "/",
  help: "/help",
  updates: "/updates",
} as const satisfies Record<WidgetModule, string>;
