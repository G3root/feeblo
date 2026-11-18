import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import { getSafeCallbackURL } from "@feeblo/post-ui/auth-flows";
import { Alert, AlertDescription } from "@feeblo/ui/alert";
import { Button } from "@feeblo/ui/button";
import { Skeleton } from "@feeblo/ui/skeleton";
import { toastManager } from "@feeblo/ui/toast";
import { trackEvent } from "@feeblo/web-shared/analytics-provider";
import { useAuthState } from "@feeblo/web-shared/use-auth-state";
import { Delete02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useStore } from "@tanstack/react-store";
import * as Result from "effect/reactivity/AsyncResult";
import { useCallback } from "react";
import { z } from "zod";

import { markPendingWelcomeTour } from "~/features/onboarding/lib/tour-storage";
import { RegisterShell } from "~/features/register/components/register-shell";
import { RegisterWizard } from "~/features/register/components/register-wizard";
import { WorkspacePreview } from "~/features/register/components/workspace-preview";
import { useObjectUrl } from "~/features/register/hooks/use-object-url";
import { useRegisterWizard } from "~/features/register/hooks/use-register-wizard";
import type { RegisterOutcome } from "~/features/register/lib/register-wizard-machine";
import { SlugAvailabilityProvider } from "~/features/register/lib/slug-availability-context";
import { DeleteWorkspaceDialog } from "~/features/settings/components/delete-workspace-dialog";
import { workspaceCreationStateAtom } from "~/features/workspace/atoms";

const SearchSchema = z.object({
  redirectTo: z.string().optional(),
});

export const Route = createFileRoute("/_dashboard/register")({
  validateSearch: (search) => SearchSchema.parse(search),
  component: RegisterRoute,
});

function RegisterRoute() {
  const navigate = Route.useNavigate();
  const search = Route.useSearch();
  const { refetch } = useAuthState();
  const creationState = useAtomValue(workspaceCreationStateAtom);
  const refreshCreationState = useAtomRefresh(workspaceCreationStateAtom);

  /**
   * What happens once the workspace exists and its logo and invitations have
   * settled. The wizard has already been through every failure it can recover
   * from by the time this runs.
   */
  const onCreated = useCallback(
    async (outcome: RegisterOutcome) => {
      trackEvent("org_created", { success: true });

      if (outcome.failedInvites.length > 0) {
        toastManager.add({
          description: `${outcome.failedInvites.join(", ")} could not be invited. You can try again from settings.`,
          title: "Workspace created",
          type: "warning",
        });
      } else {
        toastManager.add({
          description:
            outcome.invited.length > 0
              ? `${outcome.invited.length} invitation${outcome.invited.length === 1 ? "" : "s"} sent.`
              : undefined,
          title: "Workspace created",
          type: "success",
        });
      }

      // The tour talks about sample posts and a board address that every
      // workspace now has, but only a first workspace is worth interrupting
      // someone for. The gate consumes the flag and clears it.
      if (outcome.isFirstWorkspace) {
        markPendingWelcomeTour();
      }

      // The atom still caches the pre-create count; refresh it for a later
      // return to this page through the switcher.
      refreshCreationState();
      // Awaited, not fired and forgotten. The dashboard's guard reads the
      // session, which does not name the workspace until this resolves, so
      // navigating first sends the reader back here with a `redirectTo` for the
      // workspace they just made. That is what the e2e suite caught: every
      // create landed on `/register?redirectTo=/org_...` instead of the board.
      await refetch();

      if (search.redirectTo !== undefined) {
        // The guard sends an org-less visitor here with the path it bounced,
        // so resume it now that a workspace exists. `getSafeCallbackURL`
        // rejects protocol-relative and absolute values, so the search param
        // cannot turn this into an open redirect.
        window.location.assign(getSafeCallbackURL(search.redirectTo));

        return;
      }

      void navigate({
        params: { organizationId: outcome.organizationId },
        to: "/$organizationId",
      });
    },
    [navigate, refetch, refreshCreationState, search.redirectTo]
  );

  return Result.builder(creationState)
    .onInitial(() => (
      <RegisterShell>
        <RegisterLoadingCard />
      </RegisterShell>
    ))
    .onFailure(() => (
      <RegisterShell>
        <RegisterErrorCard onRetry={refreshCreationState} />
      </RegisterShell>
    ))
    .onSuccess((state) =>
      state.canCreate ? (
        <RegisterFlow onCreated={onCreated} />
      ) : (
        <RegisterShell>
          <WorkspaceLimitCard
            freeWorkspaces={state.freeWorkspaces}
            onDeleted={refreshCreationState}
            reason={state.reason}
          />
        </RegisterShell>
      )
    )
    .exhaustive();
}

/**
 * The wizard and the preview, which share three things: the slug check, the
 * draft, and the machine that decides which question is current.
 *
 * Separated from the route so the hook order is stable: `useRegisterWizard`
 * mounts only when the workspace may be created, and the route above renders
 * either this or a card, never both.
 */
function RegisterFlow({
  onCreated,
}: {
  readonly onCreated: (outcome: RegisterOutcome) => void;
}) {
  const wizard = useRegisterWizard({ onCreated });
  const logo = useStore(wizard.form.store, (state) => state.values.logo);
  const logoUrl = useObjectUrl(logo);
  const auth = useAuthState();

  return (
    <SlugAvailabilityProvider value={wizard.slug}>
      <RegisterShell
        preview={
          <WorkspacePreview
            authorName={auth.data?.user.name ?? wizard.values.workspaceName}
            boards={wizard.values.boards}
            logoUrl={logoUrl}
            subdomain={wizard.values.subdomain}
            workspaceName={wizard.values.workspaceName}
          />
        }
      >
        <RegisterWizard wizard={wizard} />
      </RegisterShell>
    </SlugAvailabilityProvider>
  );
}

/**
 * The cap state. The free workspaces are listed because they are the only
 * thing that changes the answer: deleting one (or upgrading it) frees the
 * slot, and each row links to the workspace itself.
 */
function WorkspaceLimitCard({
  reason,
  freeWorkspaces,
  onDeleted,
}: {
  readonly reason: string | null;
  readonly freeWorkspaces: readonly {
    readonly id: string;
    readonly name: string;
  }[];
  readonly onDeleted: () => void;
}) {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight text-balance">
          Workspace limit reached
        </h1>
        <p className="text-muted-foreground text-sm">
          {reason ?? "You cannot create another workspace right now."}
        </p>
      </div>

      <Alert variant="warning">
        <AlertDescription>
          Delete one to free a slot, or upgrade a workspace to keep it.
        </AlertDescription>
      </Alert>

      <div className="flex flex-col gap-2">
        {freeWorkspaces.map((workspace) => (
          <div
            className="flex items-center justify-between gap-2 rounded-lg border p-2 pl-3"
            key={workspace.id}
          >
            <Link
              className="truncate text-sm font-medium hover:underline"
              params={{ organizationId: workspace.id }}
              to="/$organizationId"
            >
              {workspace.name}
            </Link>
            <DeleteWorkspaceDialog
              organizationId={workspace.id}
              onDeleted={onDeleted}
              trigger={
                <Button
                  aria-label={`Delete ${workspace.name}`}
                  size="icon-sm"
                  variant="ghost"
                >
                  <HugeiconsIcon icon={Delete02Icon} />
                </Button>
              }
              workspaceName={workspace.name}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function RegisterLoadingCard() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-6 w-40" />
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-10 w-full" />
    </div>
  );
}

function RegisterErrorCard({ onRetry }: { readonly onRetry: () => void }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight">
          Could not load your workspaces
        </h1>
        <p className="text-muted-foreground text-sm">
          We could not check whether you can create a workspace.
        </p>
      </div>

      <Alert variant="error">
        <AlertDescription>
          Check your connection and try again.
        </AlertDescription>
      </Alert>

      <Button onClick={onRetry} size="lg" type="button" variant="outline">
        Try again
      </Button>
    </div>
  );
}
