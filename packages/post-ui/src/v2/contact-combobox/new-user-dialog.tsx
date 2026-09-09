import { Button } from "@feeblo/ui/button";
import {
  Dialog,
  DialogHeader,
  DialogPopup,
  DialogTitle,
} from "@feeblo/ui/dialog";
import { Separator } from "@feeblo/ui/separator";
import { parseRpcError } from "@feeblo/web-shared/rpc-error";
import {
  EmailSchema,
  isDeliverableAuthorEmail,
} from "@feeblo/web-shared/user-validation";
import { UserAdd01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { ReactNode } from "react";
import { useState } from "react";

import { m } from "../../paraglide/messages.js";

export type NewUserValues = {
  email: string;
  name: string;
};

/**
 * Popover footer opening the dialog; pairs with NewUserDialog. Shared by
 * the voter popover and the comment options popover so the entry point
 * looks and behaves identically in both.
 */
export function NewUserFooter({
  children,
  disabled = false,
  onNewUser,
}: {
  children: ReactNode;
  disabled?: boolean;
  onNewUser: () => void;
}) {
  return (
    <div className="px-1 pt-2 pb-1">
      <Separator className="mb-2" />
      <Button
        className="w-full justify-start"
        disabled={disabled}
        onClick={onNewUser}
        size="sm"
        type="button"
        variant="brand"
      >
        <HugeiconsIcon icon={UserAdd01Icon} strokeWidth={2} />
        {children}
      </Button>
    </div>
  );
}

/**
 * Shared "person not yet in the system" form. It only collects and validates
 * a name/email pair — what happens with them is the caller's `onSubmit`
 * (voting immediately, or staging an on-behalf author). Rejects surface
 * inline; the form resets whenever the dialog closes.
 */
export function NewUserDialog({
  onOpenChange,
  onSubmit,
  open,
  submitLabel,
  title = m.aloof_active_angelfish(),
}: {
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: NewUserValues) => Promise<void>;
  open: boolean;
  submitLabel: string;
  title?: string;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const reset = () => {
    setName("");
    setEmail("");
    setError(null);
    setIsSubmitting(false);
  };

  const handleSubmit = async () => {
    const nextName = name.trim();
    const nextEmail = email.trim();
    if (!nextName) {
      setError(m.keen_trite_gecko());
      return;
    }
    // The deliverability check mirrors the server's `AuthorEmail` filter
    // (`PostCreateAuthor.email`): without it, dotted junk passes the dialog
    // and fails on submit with a raw RPC error.
    if (
      !EmailSchema.safeParse(nextEmail).success ||
      !isDeliverableAuthorEmail(nextEmail)
    ) {
      setError(m.tense_super_wallaby());
      return;
    }
    setError(null);
    setIsSubmitting(true);
    try {
      await onSubmit({ email: nextEmail, name: nextName });
      onOpenChange(false);
      reset();
    } catch (submitError) {
      setError(parseRpcError(submitError).message);
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog
      onOpenChange={(nextOpen) => {
        onOpenChange(nextOpen);
        if (!nextOpen) {
          reset();
        }
      }}
      open={open}
    >
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-2 px-6 pb-6">
          <input
            aria-label={m.raw_cool_wolf()}
            className="border-border/50 placeholder:text-muted-foreground/50 focus:border-border w-full rounded-md border bg-transparent px-2.5 py-1.5 text-xs outline-none"
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void handleSubmit();
              }
            }}
            placeholder={m.raw_cool_wolf()}
            type="text"
            value={name}
          />
          <input
            aria-label={m.slimy_lofty_leopard()}
            className="border-border/50 placeholder:text-muted-foreground/50 focus:border-border w-full rounded-md border bg-transparent px-2.5 py-1.5 text-xs outline-none"
            onChange={(event) => setEmail(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void handleSubmit();
              }
            }}
            placeholder={m.slimy_lofty_leopard()}
            type="email"
            value={email}
          />
          {error ? (
            <p className="text-destructive text-[11px]">{error}</p>
          ) : null}
          <Button
            className="w-full"
            disabled={!name.trim() || !email.trim() || isSubmitting}
            onClick={() => void handleSubmit()}
            size="sm"
            type="button"
          >
            {isSubmitting ? m.tangy_frail_wren() : submitLabel}
          </Button>
        </div>
      </DialogPopup>
    </Dialog>
  );
}
