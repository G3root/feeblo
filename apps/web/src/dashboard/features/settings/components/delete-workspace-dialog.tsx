import { Alert, AlertDescription } from "@feeblo/ui/alert";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@feeblo/ui/alert-dialog";
import { Button } from "@feeblo/ui/button";
import { Input } from "@feeblo/ui/input";
import { Label } from "@feeblo/ui/label";
import { trackEvent } from "@feeblo/web-shared/analytics-provider";
import { authClient } from "@feeblo/web-shared/auth-client";
import { Delete02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useId, useState, type ReactElement } from "react";

/**
 * Deleting a workspace is the only in-product way to erase everything a
 * workspace holds, so it is confirmed by typing the workspace name and never
 * applied optimistically. The server cancels the Polar subscription before the
 * row (and its cascaded content) disappears.
 *
 * The caller may supply its own `trigger` — the register page renders a trash
 * icon per free workspace — and an `onDeleted` callback to keep the page and
 * refresh its own state instead of the default full-navigation reload.
 */
export function DeleteWorkspaceDialog({
  organizationId,
  workspaceName,
  trigger,
  onDeleted,
}: {
  readonly organizationId: string;
  readonly workspaceName: string;
  readonly trigger?: ReactElement;
  readonly onDeleted?: () => void;
}) {
  const confirmId = useId();
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const confirmed = confirmation.trim() === workspaceName;

  const close = () => {
    setOpen(false);
    setConfirmation("");
    setError(null);
  };

  const deleteWorkspace = async () => {
    if (!confirmed) {
      return;
    }
    setIsDeleting(true);
    setError(null);
    try {
      const result = await authClient.organization.delete({ organizationId });
      if (result.error) {
        trackEvent("org_deleted", { success: false });
        setError(result.error.message ?? "Could not delete the workspace.");
        return;
      }
      trackEvent("org_deleted", { success: true });
      if (onDeleted === undefined) {
        // Every organization-scoped cache in the SPA belongs to a workspace
        // that no longer exists; a full navigation rebuilds them against the
        // next workspace (or the registration page when this was the last
        // one).
        window.location.assign("/");
        return;
      }
      // The caller keeps the page (register's limit card) and refreshes its
      // own state instead of navigating away.
      close();
      onDeleted();
    } catch {
      // A rejected request (transport, or a body the client could not parse)
      // must surface as a failure, not as a silently still-open dialog.
      trackEvent("org_deleted", { success: false });
      setError("Could not delete the workspace. Try again.");
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <AlertDialog
      onOpenChange={(next) => {
        if (isDeleting) {
          return;
        }
        if (next) {
          setOpen(true);
          return;
        }
        close();
      }}
      open={open}
    >
      <AlertDialogTrigger
        render={
          trigger ?? (
            <Button size="sm" variant="destructive">
              <HugeiconsIcon icon={Delete02Icon} /> Delete workspace
            </Button>
          )
        }
      />
      <AlertDialogPopup>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {workspaceName}?</AlertDialogTitle>
          <AlertDialogDescription>
            Boards, posts, comments, integrations, and API keys are deleted
            immediately, and any paid subscription is cancelled. This cannot be
            undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="flex flex-col gap-3 px-6 pb-2">
          {error === null ? null : (
            <Alert variant="error">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={confirmId}>Type {workspaceName} to confirm</Label>
            <Input
              autoComplete="off"
              id={confirmId}
              disabled={isDeleting}
              onChange={(event) => setConfirmation(event.target.value)}
              placeholder={workspaceName}
              value={confirmation}
            />
          </div>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
          <Button
            disabled={isDeleting || !confirmed}
            loading={isDeleting}
            onClick={() => void deleteWorkspace()}
            variant="destructive"
          >
            Delete workspace
          </Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}
