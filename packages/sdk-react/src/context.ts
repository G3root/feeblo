import type { UserIdentity, WidgetModule } from "@feeblo/sdk";
import { createContext, useContext } from "react";

/**
 * Everything a component needs to drive the Feeblo widget. Actions are stable
 * across renders; `isReady` and `isOpen` are reactive state.
 */
export interface FeebloContextValue {
  close: () => void;
  identify: (user: UserIdentity) => void;
  /** Whether the widget is currently open. Updated optimistically and corrected by widget events. */
  readonly isOpen: boolean;
  /** Whether the widget has signalled it finished loading. */
  readonly isReady: boolean;
  metadata: (patch: Record<string, string | null>) => void;
  open: () => void;
  openModule: (module: WidgetModule) => void;
  setBoard: (board: string) => void;
}

export const FeebloContext = createContext<FeebloContextValue | null>(null);

/**
 * Access the Feeblo widget mounted by the enclosing {@link FeebloProvider}.
 *
 * @example
 * const feeblo = useFeeblo();
 * feeblo.open();
 */
export function useFeeblo(): FeebloContextValue {
  const value = useContext(FeebloContext);
  if (value === null) {
    throw new Error(
      "[feeblo-sdk-react] `useFeeblo` must be used inside a <FeebloProvider>."
    );
  }
  return value;
}
