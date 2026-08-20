import * as React from "react";

import type { FeebloWidget, UserIdentity, WidgetModule } from "../types";

export interface FeebloContextValue {
  readonly close: () => void;
  readonly identify: (user: UserIdentity) => void;
  readonly isOpen: boolean;
  readonly isReady: boolean;
  readonly metadata: (patch: Record<string, string | null>) => void;
  readonly open: (
    trigger?: HTMLElement,
    metadata?: Record<string, string>,
  ) => void;
  readonly openModule: (module: WidgetModule) => void;
  readonly organizationId: string;
  readonly setBoard: (board: string) => void;
  readonly widget: FeebloWidget | null;
}

export const FeebloContext = React.createContext<FeebloContextValue | null>(
  null,
);

export function useFeebloContext(): FeebloContextValue {
  const ctx = React.useContext(FeebloContext);
  if (!ctx) {
    throw new Error(
      "[feeblo-sdk/react] useFeeblo must be used within <FeebloProvider>",
    );
  }
  return ctx;
}
