import type { WidgetModule } from "@feeblo/feedback-widget/config";
import { createStore } from "@xstate/store";

import { createStoreContext } from "~/lib/xstate";

import {
  createWidgetDraft,
  widgetDraftReducer,
  type WidgetDraft,
  type WidgetInstallTab,
  type WidgetLauncher,
  type WidgetTheme,
} from "./widget-config";

/**
 * The widget page's shared state. Sections subscribe to the slices they
 * render, so switching the install tab does not re-render the preview and
 * toggling a module does not re-render the identity steps.
 *
 * The draft rules stay in `widget-config.ts`; every event here just feeds the
 * matching action through `widgetDraftReducer` so the pure transitions remain
 * the single tested source of truth.
 */
interface WidgetStoreContext {
  draft: WidgetDraft;
  installTab: WidgetInstallTab;
}

function createWidgetStore(theme: WidgetTheme = "light") {
  const context: WidgetStoreContext = {
    draft: createWidgetDraft(theme),
    installTab: "vanilla",
  };

  return createStore({
    context,
    on: {
      moveModule: (context, event: { from: number; to: number }) => ({
        ...context,
        draft: widgetDraftReducer(context.draft, {
          type: "moveModule",
          from: event.from,
          to: event.to,
        }),
      }),
      setInstallTab: (context, event: { tab: WidgetInstallTab }) => ({
        ...context,
        installTab: event.tab,
      }),
      setLauncher: (context, event: { launcher: WidgetLauncher }) => ({
        ...context,
        draft: widgetDraftReducer(context.draft, {
          type: "setLauncher",
          launcher: event.launcher,
        }),
      }),
      setTheme: (context, event: { theme: WidgetTheme }) => ({
        ...context,
        draft: widgetDraftReducer(context.draft, {
          type: "setTheme",
          theme: event.theme,
        }),
      }),
      toggleModule: (context, event: { module: WidgetModule }) => ({
        ...context,
        draft: widgetDraftReducer(context.draft, {
          type: "toggleModule",
          module: event.module,
        }),
      }),
    },
  });
}

export const [WidgetStoreProvider, useWidgetStore] = createStoreContext({
  createStore: createWidgetStore,
  errorMessage: "`useWidgetStore` must be used within `WidgetStoreProvider`.",
  hookName: "useWidgetStore",
  name: "WidgetStoreContext",
  providerName: "WidgetStoreProvider",
});
