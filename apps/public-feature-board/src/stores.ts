import { map } from "nanostores";

type AuthDialogVariant = "sign-in" | "sign-up";

interface TAuthDialogStore {
  isOpen: boolean;
  variant: AuthDialogVariant;
}

export const authDialogStore = map<TAuthDialogStore>({
  isOpen: false,
  variant: "sign-in",
});

export function openAuthDialog(variant: AuthDialogVariant) {
  authDialogStore.set({
    isOpen: true,
    variant,
  });
}

export function closeAuthDialog() {
  authDialogStore.setKey("isOpen", false);
}
