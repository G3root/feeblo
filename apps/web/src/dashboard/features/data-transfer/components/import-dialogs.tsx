import type { TDataImportJobSummary } from "@feeblo/domain/data-transfer/schema";
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

import { m } from "@/paraglide/messages.js";

import { plannedRowCount } from "../format";

/**
 * The one confirmation before an import writes anything.
 *
 * The counts are the point: a person sees how many posts will exist, how many
 * carry a substituted value, and which boards do not exist yet. The dialog
 * never closes itself; the caller closes it when the mutation settles.
 */
export function ConfirmImportDialog({
  busy = false,
  job,
  newBoards,
  onConfirm,
  onOpenChange,
  open,
}: {
  readonly busy?: boolean;
  readonly job: TDataImportJobSummary;
  readonly newBoards: readonly string[];
  readonly onConfirm: () => void;
  readonly onOpenChange: (open: boolean) => void;
  readonly open: boolean;
}) {
  const count = plannedRowCount(job);
  const shownBoards = newBoards.slice(0, 3).join(", ");
  const boardsCopy =
    newBoards.length > 3
      ? `${shownBoards}, +${newBoards.length - 3}`
      : shownBoards;

  return (
    <AlertDialog onOpenChange={onOpenChange} open={open}>
      <AlertDialogPopup>
        <AlertDialogHeader>
          <AlertDialogTitle>{m.brave_quiet_moth({ count })}</AlertDialogTitle>
          <AlertDialogDescription className="flex flex-col gap-2">
            <span>{m.sunny_bold_crab({ count })}</span>
            {job.warningCount > 0 ? (
              <span>{m.warm_bold_lynx({ count: job.warningCount })}</span>
            ) : null}
            {newBoards.length > 0 ? (
              <span>{m.plain_calm_koi({ boards: boardsCopy })}</span>
            ) : null}
            <span>{m.quiet_brave_moth()}</span>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{m.early_careful_coyote()}</AlertDialogCancel>
          <Button loading={busy} onClick={onConfirm}>
            {m.zesty_fresh_mole({ count })}
          </Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}

/**
 * The confirmation before a cancel. A staged job writes nothing, so its copy
 * says discarded; a running job keeps the posts it already created, and the
 * dialog says so instead of implying the whole import disappears.
 */
export function CancelImportDialog({
  busy = false,
  job,
  onConfirm,
  onOpenChange,
  open,
}: {
  readonly busy?: boolean;
  readonly job: TDataImportJobSummary;
  readonly onConfirm: () => void;
  readonly onOpenChange: (open: boolean) => void;
  readonly open: boolean;
}) {
  const staged = job.status === "awaiting_confirmation";
  return (
    <AlertDialog onOpenChange={onOpenChange} open={open}>
      <AlertDialogPopup>
        <AlertDialogHeader>
          <AlertDialogTitle>{m.tidy_bold_wren()}</AlertDialogTitle>
          <AlertDialogDescription className="flex flex-col gap-2">
            <span>{m.soft_calm_yak()}</span>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{m.early_careful_coyote()}</AlertDialogCancel>
          <Button loading={busy} onClick={onConfirm} variant="destructive">
            {staged ? m.plain_kind_auk() : m.calm_brave_wren()}
          </Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}
