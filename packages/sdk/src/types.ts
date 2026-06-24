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
  id: string;
  monthlySpend?: number | undefined;
  name: string;
}

export interface UserIdentity {
  avatar?: string | undefined;
  companies?: WidgetCompany[] | undefined;
  email?: string | undefined;
  firstName?: string | undefined;
  id: string;
  lastName?: string | undefined;
  token?: string | undefined;
}

export interface NormalizedUserIdentity {
  avatar?: string | undefined;
  companies?: WidgetCompany[] | undefined;
  email?: string | undefined;
  firstName?: string | undefined;
  id: string;
  lastName?: string | undefined;
  token?: string | undefined;
}

export interface SubmittedFeedback {
  boardId: string;
  boardName: string;
  title: string;
}

export interface EmbedOptions {
  baseUrl?: string | undefined;
  containerStyles?: Partial<CSSStyleDeclaration> | undefined;
  debug?: boolean | undefined;
  onClose?: (() => void) | undefined;
  onError?: ((error: EmbedError) => void) | undefined;
  onHeightChange?: ((height: number) => void) | undefined;
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
  open: (
    trigger?: HTMLElement,
    metadata?: Record<string, string>
  ) => FeebloWidget;
  setBoard: (board: string) => FeebloWidget;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export type FeebloEventName =
  | "widgetReady"
  | "widgetOpened"
  | "feedbackSubmitted";

export interface FeebloEventMap {
  feedbackSubmitted: SubmittedFeedback | undefined;
  widgetOpened: unknown;
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
  | { event: "READY" }
  | { event: "WIDGET_OPENED"; data?: unknown }
  | {
      event: "FEEDBACK_SUBMITTED";
      data?: { post?: SubmittedFeedback | undefined } | undefined;
    };

export type OutgoingMessage =
  | { event: "SHOW" }
  | { event: "HIDE" }
  | { event: "IDENTIFY"; data: Record<string, unknown> }
  | { event: "SET_BOARD"; data: { board: string } };

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
