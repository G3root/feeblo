import { createStore } from "@xstate/store";
import { createContext, useContext as useReactContext, useRef } from "react";

type AnyRecord = Record<string, unknown>;

export interface CreateStoreContextOptions<TStore, TDefaultValue = undefined> {
  createStore: (defaultValue?: TDefaultValue) => TStore;
  errorMessage?: string | undefined;
  hookName?: string | undefined;
  name?: string | undefined;
  providerName?: string | undefined;
}

export function createStoreContext<TStore, TDefaultValue = undefined>(
  options: CreateStoreContextOptions<TStore, TDefaultValue>
) {
  const {
    createStore: createStoreForContext,
    name,
    hookName = "useContext",
    providerName = "Provider",
    errorMessage,
  } = options;

  const Context = createContext<TStore | null>(null);
  Context.displayName = name;

  function useContext() {
    const context = useReactContext(Context);

    if (!context) {
      const error = new Error(
        errorMessage ??
          `\`${hookName}\` must be used within \`${providerName}\``
      );
      error.name = "ContextError";
      Error.captureStackTrace?.(error, useContext);
      throw error;
    }

    return context;
  }

  type ProviderProps = {
    children: React.ReactNode;
    defaultValue?: TDefaultValue;
  };

  const Provider: React.FC<ProviderProps> = (props) => {
    const { children, defaultValue: providerDefaultValue } = props;
    const store = useRef<TStore | null>(null);

    if (!store.current) {
      store.current = createStoreForContext(providerDefaultValue);
    }

    return (
      <Context.Provider value={store.current}>{children}</Context.Provider>
    );
  };

  return [Provider, useContext] as const;
}

export type ModalStoreContextValue<TData extends AnyRecord> = {
  open: boolean;
  data: TData;
};

export const createModalStore = <TData extends AnyRecord>(
  defaultValue?: Partial<ModalStoreContextValue<TData>>
) =>
  createStore({
    context: {
      open: false,
      data: {} as TData,
      ...defaultValue,
    },
    on: {
      setOpen: (context, event: { open: boolean; data?: TData }) => ({
        ...context,
        open: event.open,
        ...(event.data !== undefined ? { data: event.data } : {}),
      }),
      toggle: (context, event: { data?: TData }) => ({
        ...context,
        open: !context.open,
        ...(event.data !== undefined ? { data: event.data } : {}),
      }),
      setData: (context, event: { data: TData }) => ({
        ...context,
        data: event.data,
      }),
    },
  });

export interface CreateModalStoreContextOptions {
  errorMessage?: string | undefined;
  hookName?: string | undefined;
  name?: string | undefined;
  providerName?: string | undefined;
}

export function createModalStoreContext<T extends AnyRecord>(
  options: CreateModalStoreContextOptions
) {
  return createStoreContext<
    ReturnType<typeof createModalStore<T>>,
    Partial<ModalStoreContextValue<T>>
  >({
    ...options,
    createStore: createModalStore<T>,
  });
}
