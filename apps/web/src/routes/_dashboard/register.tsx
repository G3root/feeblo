import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import { getSafeCallbackURL } from "@feeblo/post-ui/auth-flows";
import { Alert, AlertDescription, AlertTitle } from "@feeblo/ui/alert";
import { Button } from "@feeblo/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardPanel,
  CardTitle,
} from "@feeblo/ui/card";
import { useAppForm } from "@feeblo/ui/hooks/form";
import { Skeleton } from "@feeblo/ui/skeleton";
import { toastManager } from "@feeblo/ui/toast";
import { trackEvent } from "@feeblo/web-shared/analytics-provider";
import { parseRpcError } from "@feeblo/web-shared/rpc-error";
import { useAuthState } from "@feeblo/web-shared/use-auth-state";
import { Delete02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useStore } from "@tanstack/react-store";
import * as Result from "effect/reactivity/AsyncResult";
import { z } from "zod";

import { markPendingWelcomeTour } from "~/features/onboarding/lib/tour-storage";
import { RegisterShell } from "~/features/register/components/register-shell";
import { RegisterWorkspaceStep } from "~/features/register/components/register-workspace-step";
import { WorkspacePreview } from "~/features/register/components/workspace-preview";
import { useWorkspaceSlugAvailability } from "~/features/register/hooks/use-workspace-slug-availability";
import { SlugAvailabilityProvider } from "~/features/register/lib/slug-availability-context";
import { registerFormOpts } from "~/features/register/shared-form";
import { DeleteWorkspaceDialog } from "~/features/settings/components/delete-workspace-dialog";
import { workspaceCreationStateAtom } from "~/features/workspace/atoms";
import { fetchRpc } from "~/lib/runtime";

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

  const form = useAppForm({
    ...registerFormOpts,
    onSubmit: async ({ value }) => {
      try {
        const result = await fetchRpc((rpc) =>
          rpc.CreateWorkspace({
            workspaceName: value.workspaceName,
          })
        );

        if (result.organizationId) {
          trackEvent("org_created", { success: true });
          toastManager.add({
            title: "Workspace created successfully",
            type: "success",
          });

          // Queued before the navigation, and only for a first workspace: the
          // tour talks about sample posts and a board URL that every workspace
          // now has, but only the first is worth interrupting someone for. The
          // gate consumes the flag and drops it.
          if (result.isFirstWorkspace) {
            markPendingWelcomeTour();
          }

          // The atom still caches the pre-create count; refresh it for a later
          // return to this page through the switcher.
          refreshCreationState();
          await refetch();

          if (search.redirectTo !== undefined) {
            // The guard sends an org-less visitor here with the path it
            // bounced, so resume it now that a workspace exists — otherwise
            // the deep link is silently dropped. `getSafeCallbackURL` rejects
            // protocol-relative and absolute values, so the search param
            // cannot turn this into an open redirect.
            window.location.assign(getSafeCallbackURL(search.redirectTo));

            return;
          }

          void navigate({
            to: "/$organizationId",
            params: { organizationId: result.organizationId },
          });

          return;
        }
      } catch (error) {
        trackEvent("org_created", { success: false });
        toastManager.add({
          title: parseRpcError(error, "Failed to create workspace").message,
          type: "error",
        });

        return;
      }
    },
  });

  /** The subdomain the preview shows, and the check the form field shows. */
  const workspaceName = useStore(
    form.store,
    // SAFETY: The upstream contract guarantees a string here.
    (state) => (state.values.workspaceName as string) || ""
  );

  const slugAvailability = useWorkspaceSlugAvailability(workspaceName);
  const slugTaken = slugAvailability.availability.status === "taken";

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
        <SlugAvailabilityProvider value={slugAvailability}>
          <RegisterShell
            preview={<WorkspacePreview workspaceName={workspaceName} />}
          >
            {/* Plain on this page: the split already gives the form a column
                of its own, and a bordered card inside it would read as the
                centred card this layout replaced. */}
            <Card className="border-0 bg-transparent shadow-none before:hidden">
              <CardHeader>
                <CardTitle>Create a new Workspace</CardTitle>
                <CardDescription>
                  create a new workspace to get started
                </CardDescription>
              </CardHeader>

              <CardPanel>
                <form
                  className="flex flex-col gap-5"
                  id="register-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    void form.handleSubmit();
                  }}
                >
                  <RegisterShell.Body>
                    <RegisterWorkspaceStep form={form} />
                  </RegisterShell.Body>
                </form>
              </CardPanel>
            </Card>

            <form.Subscribe
              selector={(formState) =>
                [
                  formState.isSubmitting,
                  !formState.canSubmit,
                  // In the selector, not captured from the parent render: the
                  // subscription only re-renders when its selected tuple
                  // changes, so a captured value would leave the button
                  // enabled after the check settled on "taken".
                  slugTaken,
                ] as const
              }
            >
              {([isSubmitting, isInvalid, isSlugTaken]) => (
                <Button
                  className="w-full"
                  // A taken subdomain is refused by the server too, but the
                  // field already knows: blocking the submit is what keeps the
                  // reader from discovering it as a toast after a round trip.
                  disabled={isInvalid || isSlugTaken}
                  form="register-form"
                  loading={isSubmitting}
                  size="lg"
                  type="submit"
                >
                  Create Workspace
                </Button>
              )}
            </form.Subscribe>
          </RegisterShell>
        </SlugAvailabilityProvider>
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
    <Card>
      <CardHeader>
        <CardTitle>Workspace limit reached</CardTitle>
        <CardDescription>
          {reason ?? "You cannot create another workspace right now."}
        </CardDescription>
      </CardHeader>
      <CardPanel className="flex flex-col gap-4">
        <Alert variant="warning">
          <AlertTitle>Free workspaces</AlertTitle>
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
      </CardPanel>
    </Card>
  );
}

function RegisterLoadingCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Create a new Workspace</CardTitle>
        <CardDescription>create a new workspace to get started</CardDescription>
      </CardHeader>
      <CardPanel className="flex flex-col gap-4">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-10 w-full" />
      </CardPanel>
    </Card>
  );
}

function RegisterErrorCard({ onRetry }: { readonly onRetry: () => void }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Could not load your workspaces</CardTitle>
        <CardDescription>
          We could not check whether you can create a workspace.
        </CardDescription>
      </CardHeader>
      <CardPanel className="flex flex-col gap-4">
        <Alert variant="error">
          <AlertDescription>
            Check your connection and try again.
          </AlertDescription>
        </Alert>
        <Button onClick={onRetry} size="lg" type="button" variant="outline">
          Try again
        </Button>
      </CardPanel>
    </Card>
  );
}
