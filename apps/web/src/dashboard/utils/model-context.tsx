/** biome-ignore-all lint/suspicious/noExplicitAny: Required for flexible modal data types */
import { createStore } from "@xstate/store";
import { createContext, useContext as useReactContext, useRef } from "react";

type ModalStoreContextValue<TData extends Record<string, any>> = {
  open: boolean;
  data: TData;
};

const createModalStore = <TData extends Record<string, any>>(
  defaultValue?: ModalStoreContextValue<TData>
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
        ...(event.data && { data: event.data }),
      }),
      toggle: (context, event: { data?: TData }) => ({
        ...context,
        open: !context.open,
        ...(event.data && { data: event.data }),
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

export function createModalStoreContext<T extends Record<string, any>>(
  options: CreateModalStoreContextOptions
) {
  const {
    name,
    hookName = "useContext",
    providerName = "Provider",
    errorMessage,
  } = options;

  const Context = createContext<ReturnType<typeof createModalStore<T>> | null>(
    null
  );

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
    defaultValue?: Partial<ModalStoreContextValue<T>>;
  };

  const Provider: React.FC<ProviderProps> = (props) => {
    const { children, defaultValue: providerDefaultValue } = props;

    const store = useRef<ReturnType<typeof createModalStore<T>> | null>(null);
    if (!store.current) {
      store.current = createModalStore<T>(
        providerDefaultValue as ModalStoreContextValue<T>
      );
    }

    return (
      <Context.Provider value={store.current}>{children}</Context.Provider>
    );
  };

  return [Provider, useContext] as const;
}
