// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

import type { EmbedError } from "./errors";

/**
 * Branded identifier for a Feeblo organization. Use {@link organizationId} to
 * create one from a raw string. Plain strings remain accepted everywhere for
 * ergonomics; the brand exists for integrators who want to distinguish widget
 * IDs from arbitrary strings at type-check time.
 */
export type OrganizationId = string & {
  readonly __feebloOrganizationId: unique symbol;
};

export interface WidgetCompany {
  avatar?: string | undefined;
  customFields?: Record<string, unknown> | undefined;
  id: string;
  name: string;
}

export interface UserIdentity {
  avatar?: string | undefined;
  companies?: WidgetCompany[] | undefined;
  customFields?: Record<string, unknown> | undefined;
  email?: string | undefined;
  id: string;
  name?: string | undefined;
  token?: string | undefined;
}

export type PublicUserIdentity = Omit<UserIdentity, "token">;

export interface NormalizedUserIdentity {
  avatar?: string | undefined;
  companies?: WidgetCompany[] | undefined;
  customFields?: Record<string, unknown> | undefined;
  email?: string | undefined;
  id: string;
  name?: string | undefined;
  token?: string | undefined;
}

export interface SubmittedFeedback {
  boardId: string;
  boardName: string;
  metadata?: Record<string, string> | undefined;
  title: string;
}

export type WidgetMode = "feedback" | "updates" | "hub";
export type WidgetModule = Exclude<WidgetMode, "hub">;
export type WidgetPlacement = "bottom-left" | "bottom-right";

export interface EmbedOptions {
  baseUrl?: string | undefined;
  containerStyles?: Partial<CSSStyleDeclaration> | undefined;
  debug?: boolean | undefined;
  defaultBoard?: string | undefined;
  locale?: string | undefined;
  mode?: WidgetMode | undefined;
  modules?: WidgetModule[] | undefined;
  onClose?: (() => void) | undefined;
  onError?: ((error: EmbedError) => void) | undefined;
  onHeightChange?: ((height: number) => void) | undefined;
  placement?: WidgetPlacement | undefined;
  root?: HTMLElement | undefined;
  theme?: string | undefined;
  user?: UserIdentity | undefined;
}

/**
 * Config-object form accepted by {@link init}. Equivalent to
 * `init(organizationId, options)` but easier to read when many options are set.
 */
export interface InitConfig extends EmbedOptions {
  organizationId: string | OrganizationId;
}

// ---------------------------------------------------------------------------
// Widget API
// ---------------------------------------------------------------------------

/**
 * Handle returned by {@link init}. Every mutating method returns the widget so
 * calls can be chained: `feeblo.identify(user).setBoard("roadmap").open()`.
 */
export interface FeebloWidget {
  close: () => FeebloWidget;
  destroy: () => void;
  identify: (user: UserIdentity) => FeebloWidget;
  isOpen: () => boolean;
  metadata: (patch: Record<string, string | null>) => FeebloWidget;
  open: (
    trigger?: HTMLElement,
    metadata?: Record<string, string>
  ) => FeebloWidget;
  openModule: (module: WidgetModule) => FeebloWidget;
  setBoard: (board: string) => FeebloWidget;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export type FeebloEventName =
  | "widgetReady"
  | "widgetOpened"
  | "widgetClosed"
  | "identityChanged"
  | "feedbackSubmitted";

export interface FeebloEventMap {
  feedbackSubmitted: SubmittedFeedback | undefined;
  identityChanged: PublicUserIdentity;
  widgetClosed: undefined;
  widgetOpened: { module: WidgetModule } | undefined;
  widgetReady: undefined;
}

export interface FeebloEventDetail<
  K extends FeebloEventName = FeebloEventName,
> {
  data: FeebloEventMap[K];
  namespace: "feeblo";
  type: K;
}

export type FeebloEventListener<K extends FeebloEventName> = (
  event: CustomEvent<FeebloEventDetail<K>>
) => void;
export type FeebloOn = {
  <K extends FeebloEventName>(
    event: K,
    callback: FeebloEventListener<K>
  ): () => void;
  (event: "*", callback: FeebloEventListener<FeebloEventName>): () => void;
};

export type FeebloOff = {
  <K extends FeebloEventName>(event: K, callback: FeebloEventListener<K>): void;
  (event: "*", callback: FeebloEventListener<FeebloEventName>): void;
};

// ---------------------------------------------------------------------------
// Internal message contract (postMessage with the iframe)
// ---------------------------------------------------------------------------

export type IncomingMessage =
  | {
      event: "ERROR";
      data?:
        | { code?: string | undefined; message?: string | undefined }
        | undefined;
    }
  | { event: "PAGE_HEIGHT"; data?: { height?: number | undefined } | undefined }
  | { event: "CLOSE" }
  | { event: "IDENTITY_CHANGED"; data?: PublicUserIdentity | undefined }
  | { event: "READY" }
  | { event: "WIDGET_OPENED"; data?: { module: WidgetModule } | undefined }
  | {
      event: "FEEDBACK_SUBMITTED";
      data?: { post?: SubmittedFeedback | undefined } | undefined;
    };

export type OutgoingMessage =
  | { event: "SHOW" }
  | { event: "HIDE" }
  | { event: "IDENTIFY"; data: Record<string, unknown> }
  | { event: "SET_CONTEXT"; data: Record<string, string> }
  | { event: "SET_MODULE"; data: { module: WidgetModule } }
  | { event: "SET_BOARD"; data: { board: string } }
  | { event: "SET_LOCALE"; data: { locale: string } };

export type ExternalMessageData = {
  target: string;
  data: { action: string; setBoard?: string | undefined };
};

// ---------------------------------------------------------------------------
// Brand helpers
// ---------------------------------------------------------------------------

/**
 * Tag a raw string as an {@link OrganizationId} for stricter typing at call
 * sites. The value is unchanged at runtime.
 */
export function organizationId(id: string): OrganizationId {
  return id as unknown as OrganizationId;
}
