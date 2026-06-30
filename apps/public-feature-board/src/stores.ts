import { map } from "nanostores";

type AuthDialogVariant = "sign-in" | "sign-up";

interface TPostCreateDialogStore {
  initialBoardId: string;
  isOpen: boolean;
}

interface TAuthDialogStore {
  isOpen: boolean;
  variant: AuthDialogVariant;
}

export const postCreateDialogStore = map<TPostCreateDialogStore>({
  isOpen: false,
  initialBoardId: "",
});

export const authDialogStore = map<TAuthDialogStore>({
  isOpen: false,
  variant: "sign-in",
});

export function openPostCreateDialog(initialBoardId = "") {
  postCreateDialogStore.set({
    initialBoardId,
    isOpen: true,
  });
}

export function closePostCreateDialog() {
  postCreateDialogStore.setKey("isOpen", false);
}

export function openAuthDialog(variant: AuthDialogVariant) {
  authDialogStore.set({
    isOpen: true,
    variant,
  });
}

export function closeAuthDialog() {
  authDialogStore.setKey("isOpen", false);
}
