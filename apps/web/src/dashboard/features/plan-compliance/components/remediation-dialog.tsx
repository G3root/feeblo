import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "@feeblo/ui/alert-dialog";
import { Button } from "@feeblo/ui/button";
import { Input } from "@feeblo/ui/input";
import { Label } from "@feeblo/ui/label";
import { useState } from "react";

import type { RemediationAction } from "../lib/plan-compliance-view";

type RemediationDialogProps = {
  readonly action: RemediationAction | null;
  readonly pending: boolean;
  readonly onConfirm: (action: RemediationAction) => void;
  readonly onOpenChange: (open: boolean) => void;
};

/**
 * The one confirmation for a remediation row.
 *
 * Reversible changes (demote, cancel an invitation, publish a roadmap) take a
 * plain confirm. Anything that destroys or publishes data requires the
 * operator to type the resource's name, so a stray double-click cannot make a
 * board public or delete a board's posts.
 */
export function RemediationDialog({
  action,
  onConfirm,
  onOpenChange,
  pending,
}: RemediationDialogProps) {
  return (
    <AlertDialog onOpenChange={onOpenChange} open={action !== null}>
      {action ? (
        <RemediationDialogPopup
          action={action}
          onConfirm={onConfirm}
          pending={pending}
        />
      ) : null}
    </AlertDialog>
  );
}

function RemediationDialogPopup({
  action,
  onConfirm,
  pending,
}: {
  readonly action: RemediationAction;
  readonly onConfirm: (action: RemediationAction) => void;
  readonly pending: boolean;
}) {
  const [typed, setTyped] = useState("");
  const typedMatches =
    !action.requiresTyping ||
    typed.trim().toLowerCase() ===
      action.confirmationValue.trim().toLowerCase();

  return (
    <AlertDialogPopup>
      <AlertDialogHeader>
        <AlertDialogTitle>{action.title}</AlertDialogTitle>
        <AlertDialogDescription>{action.description}</AlertDialogDescription>
      </AlertDialogHeader>

      {action.requiresTyping ? (
        <div className="flex flex-col gap-2 px-6 pb-2">
          <Label htmlFor="remediation-confirmation">
            Type <span className="font-medium">{action.confirmationValue}</span>{" "}
            to confirm
          </Label>
          <Input
            autoComplete="off"
            id="remediation-confirmation"
            onChange={(event) => setTyped(event.target.value)}
            placeholder={action.confirmationValue}
            value={typed}
          />
        </div>
      ) : null}

      <AlertDialogFooter>
        <AlertDialogCancel>Cancel</AlertDialogCancel>
        <Button
          disabled={!typedMatches || pending}
          loading={pending}
          onClick={() => onConfirm(action)}
          type="button"
          variant={action.destructive ? "destructive" : "default"}
        >
          {action.confirmLabel}
        </Button>
      </AlertDialogFooter>
    </AlertDialogPopup>
  );
}
