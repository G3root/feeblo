import type * as React from "react";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "./alert-dialog";
import { Button } from "./button";

interface ConfirmDialogProps {
  cancelLabel?: string;
  confirmDisabled?: boolean;
  confirmLabel?: string;
  confirmLoading?: boolean;
  description: React.ReactNode;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  title: React.ReactNode;
}

/**
 * The one destructive-confirmation shell: title, description, Cancel, and a
 * destructive confirm action.
 *
 * Closing stays with the caller — `onConfirm` runs while the dialog is still
 * open, so an optimistic delete can close in the same tick and an awaited
 * revocation can keep the confirm disabled until it settles.
 */
export function ConfirmDialog({
  cancelLabel = "Cancel",
  confirmDisabled,
  confirmLabel = "Continue",
  confirmLoading,
  description,
  onConfirm,
  onOpenChange,
  open,
  title,
}: ConfirmDialogProps): React.ReactElement {
  return (
    <AlertDialog onOpenChange={onOpenChange} open={open}>
      <AlertDialogPopup>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{cancelLabel}</AlertDialogCancel>
          <Button
            disabled={confirmDisabled ?? false}
            loading={confirmLoading ?? false}
            onClick={onConfirm}
            variant="destructive"
          >
            {confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}
