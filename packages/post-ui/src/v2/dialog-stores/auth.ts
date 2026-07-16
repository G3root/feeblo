import { createModalStoreContext } from "@feeblo/web-shared/xstate";

export type AuthDialogVariant = "sign-in" | "sign-up";

export const [AuthDialogProvider, useAuthDialogContext] =
  createModalStoreContext<{
    variant: AuthDialogVariant;
  }>({
    name: "AuthDialogContext",
    hookName: "useAuthDialogContext",
    providerName: "AuthDialogProvider",
  });
