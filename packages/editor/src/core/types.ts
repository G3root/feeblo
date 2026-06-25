/**
 * Core type definitions for the editor.
 * These types are used across the core module and can be imported by plugins and UI.
 */

import type { EditorEventMap, EditorEventName } from "./event-bus";

/**
 * A single placeholder item with all metadata needed for rendering.
 * Used by the event bus and placeholder plugin.
 */
export interface PlaceholderItem {
  /** Category ID this variable belongs to */
  category: string;
  /** Display text shown in the dropdown, e.g., 'contact.email' */
  displayKey: string;
  /** Fallback value for the variable */
  fallbackValue: string | null;
  /** Full placeholder string, e.g., '{{{contact.email}}}' */
  id: string;
  /** Base key used for updates, e.g., 'contact' or the placeholder name */
  placeholderKey: string;
  /** Override fallback warning for this specific item */
  skipFallbackWarning?: boolean;
  /** Placeholder type (string, number, boolean, object, list) - needed for loop item computation */
  type?: string;
}

/**
 * Custom placeholder definition used in the placeholders plugin.
 */
export type CustomPlaceholder = {
  id: string;
  key: string;
  type: string;
  fallback_value?: string | null;
};

declare module "./event-bus" {
  export interface EditorEventMap {
    "node-clicked": NodeClickedEvent;
  }
}

/**
 * Event handler function type.
 */
export type EventHandler<T extends EditorEventName> = (
  payload: EditorEventMap[T]
) => void | Promise<void>;

/**
 * Subscription handle returned when subscribing to events.
 */
export interface EventSubscription {
  unsubscribe: () => void;
}

/**
 * Options for dispatching events.
 */
export interface DispatchOptions {
  target?: EventTarget;
}
