import { createStore } from "@xstate/store";
import { useSelector } from "@xstate/store-react";
import { createContext, useContext, useRef } from "react";

export type BoardViewMode = "list" | "grid";

type BoardViewContext = {
  mode: BoardViewMode;
};

const createBoardViewModeStore = (defaultMode: BoardViewMode) =>
  createStore({
    context: {
      mode: defaultMode,
    } as BoardViewContext,
    on: {
      setMode: (context, event: { mode: BoardViewMode }) => ({
        ...context,
        mode: event.mode,
      }),
    },
  });

type BoardViewStore = ReturnType<typeof createBoardViewModeStore>;

const BoardViewModeContext = createContext<BoardViewStore | null>(null);

export function BoardViewModeProvider({
  children,
  defaultMode = "list",
}: {
  children: React.ReactNode;
  defaultMode?: BoardViewMode;
}) {
  const storeRef = useRef<BoardViewStore | null>(null);

  if (!storeRef.current) {
    storeRef.current = createBoardViewModeStore(defaultMode);
  }

  return (
    <BoardViewModeContext.Provider value={storeRef.current}>
      {children}
    </BoardViewModeContext.Provider>
  );
}

export function useBoardViewModeStore() {
  const context = useContext(BoardViewModeContext);

  if (!context) {
    throw new Error(
      "useBoardViewModeStore must be used within BoardViewModeProvider"
    );
  }

  return context;
}

export function useBoardViewMode() {
  const store = useBoardViewModeStore();
  return useSelector(store, (state) => state.context.mode);
}
