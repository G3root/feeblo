import { useRender } from "@base-ui/react/use-render";
import { useCurrentEditor } from "@tiptap/react";
import * as React from "react";
import type { FocusScopesStorage } from "../extensions/focus-scopes";

type FocusScopeContextValue = FocusScopesStorage;

export const FocusScopeContext =
  React.createContext<FocusScopeContextValue | null>(null);

const noopFocusScope: FocusScopeContextValue = {
  registerScope: () => {},
  unregisterScope: () => {},
};

export function useEditorFocusScope() {
  const context = React.useContext(FocusScopeContext);
  const { editor } = useCurrentEditor();
  return context ?? editor?.extensionStorage?.focusScope ?? noopFocusScope;
}

export interface EditorFocusScopeProps {
  children: React.ReactNode;
}

export function EditorFocusScope({
  children,
  render,
}: EditorFocusScopeProps & useRender.ComponentProps<"div">) {
  const context = React.useContext(FocusScopeContext);
  const { editor } = useCurrentEditor();
  const focusScope = context ?? editor?.extensionStorage?.focusScope ?? null;
  const attachedElRef = React.useRef<HTMLElement | null>(null);

  const setScopeRef = React.useCallback(
    (element: HTMLElement | null) => {
      if (!focusScope) {
        return;
      }

      const prev = attachedElRef.current;
      if (prev && prev !== element) {
        focusScope.unregisterScope(prev);
      }

      attachedElRef.current = element;

      if (element) {
        focusScope.registerScope(element);
      }
    },
    [focusScope]
  );

  const element = useRender({
    defaultTagName: "div",
    render,
    ref: setScopeRef,
    props: {
      children,
    },
  });

  if (!focusScope) {
    return <>{children}</>;
  }

  return element;
}
