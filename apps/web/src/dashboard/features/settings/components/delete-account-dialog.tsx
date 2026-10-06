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
import { useAuthState } from "@feeblo/web-shared/use-auth-state";
import { Delete02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useNavigate } from "@tanstack/react-router";
import { useId, useState } from "react";

import { useOrganizationId } from "~/hooks/use-organization-id";

/**
 * Deletion is confirmed, never optimistic, and Better Auth requires either the
 * account password or a freshly authenticated session: an account signed up
 * through a social provider has no password, and a password account whose
 * session has aged past `session.freshAge` has to supply one.
 */
export function DeleteAccountDialog() {
  const organizationId = useOrganizationId();
  const navigate = useNavigate();
  const passwordId = useId();
  const { data: session } = useAuthState();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<{
    readonly code: string | undefined;
    readonly message: string;
  } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const close = () => {
    setOpen(false);
    setPassword("");
    setError(null);
  };

  const deleteAccount = async () => {
    setIsDeleting(true);
    setError(null);
    try {
      const result = await authClient.deleteUser({
        password: password.length > 0 ? password : undefined,
      });
      if (result.error) {
        trackEvent("account_deleted", { success: false });
        setError({
          code: result.error.code,
          message:
            result.error.code === "SESSION_EXPIRED" ||
            result.error.message?.toLowerCase().includes("fresh")
              ? "For your security this needs a recent sign-in. Sign out, sign back in, then try again."
              : (result.error.message ?? "Could not delete your account."),
        });
        return;
      }
      trackEvent("account_deleted", { success: true });
      // The session cookie is cleared server-side; a full navigation drops the
      // SPA's cached session so the guard resolves the signed-out state.
      window.location.assign("/sign-up");
    } catch {
      // A rejected request (transport, or a body the client could not parse)
      // must surface as a failure, not as a silently still-open dialog.
      trackEvent("account_deleted", { success: false });
      setError({
        code: undefined,
        message: "Could not delete your account. Try again.",
      });
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
          <Button size="sm" variant="destructive">
            <HugeiconsIcon icon={Delete02Icon} /> Delete account
          </Button>
        }
      />
      <AlertDialogPopup>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete account</AlertDialogTitle>
          <AlertDialogDescription>
            This permanently deletes {session?.user.email ?? "your account"}.
            Workspaces where you are the only member are deleted too, along with
            everything in them, and you are removed from the rest. This cannot
            be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="flex flex-col gap-3 px-6 pb-2">
          {error === null ? null : (
            <Alert variant="error">
              <AlertDescription>
                {error.message}
                {error.code === "WORKSPACE_OWNERSHIP_REQUIRED" ? (
                  <Button
                    onClick={() => {
                      close();
                      void navigate({
                        to: "/$organizationId/settings/members",
                        params: { organizationId },
                      });
                    }}
                    size="sm"
                    variant="outline"
                  >
                    Open Members settings
                  </Button>
                ) : null}
              </AlertDescription>
            </Alert>
          )}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={passwordId}>Password</Label>
            <Input
              autoComplete="current-password"
              id={passwordId}
              disabled={isDeleting}
              onChange={(event) => setPassword(event.target.value)}
              type="password"
              value={password}
            />
            <p className="text-muted-foreground text-xs">
              Required for accounts with a password. Accounts created with
              Google or GitHub can leave this blank.
            </p>
          </div>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
          <Button
            disabled={isDeleting}
            loading={isDeleting}
            onClick={() => void deleteAccount()}
            variant="destructive"
          >
            Delete account
          </Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}
