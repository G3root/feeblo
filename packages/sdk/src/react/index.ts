// ---------------------------------------------------------------------------
// Public entry for @feeblo/sdk/react
// Import directly to keep bundles analyzable (bundle-barrel-imports,
// bundle-analyzable-paths)
// ---------------------------------------------------------------------------

export { FeebloContext, useFeebloContext } from "./context";
export type { FeebloContextValue } from "./context";

export { FeebloProvider } from "./provider";
export type { FeebloProviderProps } from "./provider";

export {
  useFeeblo,
  useFeebloEvent,
  useFeebloIsOpen,
  useFeebloIsReady,
  useFeebloWidget,
  useOnFeedbackSubmitted,
} from "./hooks";

export { FeebloTrigger, useFeebloTrigger } from "./trigger";
export type { FeebloTriggerProps, UseFeebloTriggerOptions } from "./trigger";

// Re-export useful SDK types so consumers don't need a second import
export type {
  FeebloEventDetail,
  FeebloEventListener,
  FeebloEventMap,
  FeebloEventName,
  FeebloWidget,
  UserIdentity,
  WidgetModule,
  WidgetMode,
  WidgetPlacement,
} from "../types";
export { EmbedError } from "../errors";
export type { EmbedErrorDetails } from "../errors";
