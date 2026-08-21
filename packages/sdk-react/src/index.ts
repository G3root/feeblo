import { FeebloProvider } from "./provider";

export { useFeeblo, type FeebloContextValue } from "./context";
export type { FeebloProviderProps } from "./provider";
export { FeebloProvider };
export { useFeebloEvent } from "./use-feeblo-event";

export {
  EmbedError,
  organizationId,
  VERSION,
  type EmbedErrorDetails,
  type FeebloEventDetail,
  type FeebloEventListener,
  type FeebloEventMap,
  type FeebloEventName,
  type OrganizationId,
  type PublicUserIdentity,
  type SubmittedFeedback,
  type UserIdentity,
  type WidgetCompany,
  type WidgetMode,
  type WidgetModule,
  type WidgetPlacement,
} from "@feeblo/sdk";
