export type WidgetModule = "feedback" | "updates";
export type WidgetMode = WidgetModule | "hub";

export interface WidgetConfig {
  mode: WidgetMode;
  modules: WidgetModule[];
}

const fallback: WidgetConfig = { mode: "feedback", modules: ["feedback"] };

export function getWidgetConfig(): WidgetConfig {
  const config = (
    window as typeof window & {
      global?: { __ENV?: { widgetConfig?: WidgetConfig } };
    }
  ).global?.__ENV?.widgetConfig;
  return config ?? fallback;
}

export function moduleForPath(pathname: string): WidgetModule {
  return pathname.startsWith("/updates") ? "updates" : "feedback";
}
