import { Button } from "@feeblo/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardPanel,
  CardTitle,
} from "@feeblo/ui/card";
import { useAppForm } from "@feeblo/ui/hooks/form";
import { toastManager } from "@feeblo/ui/toast";
import { trackEvent } from "@feeblo/web-shared/analytics-provider";
import { parseRpcError } from "@feeblo/web-shared/rpc-error";
import { useAuthState } from "@feeblo/web-shared/use-auth-state";
import { createFileRoute, Link } from "@tanstack/react-router";
import { z } from "zod";

import { RegisterShell } from "~/features/register/components/register-shell";
import { RegisterWorkspaceStep } from "~/features/register/components/register-workspace-step";
import { fetchRpc } from "~/lib/runtime";

import { registerFormOpts } from "../features/register/shared-form";

const SearchSchema = z.object({
  redirectTo: z.string().optional(),
});

export const Route = createFileRoute("/register")({
  validateSearch: (search) => SearchSchema.parse(search),
  component: RegisterRoute,
});

function RegisterRoute() {
  const navigate = Route.useNavigate();
  const { data: session, refetch } = useAuthState();
  const existingOrganizationId = session?.organizations?.[0]?.id ?? null;

  const form = useAppForm({
    ...registerFormOpts,
    onSubmit: async ({ value }) => {
      try {
        const result = await fetchRpc((rpc) =>
          rpc.WorkspaceCreate({
            workspaceName: value.workspaceName,
          })
        );

        if (result.organizationId) {
          trackEvent("org_created", { success: true });
          toastManager.add({
            title: "Workspace created successfully",
            type: "success",
          });
          await refetch();
          navigate({
            to: "/$organizationId",
            params: { organizationId: result.organizationId },
          });
          return;
        }
      } catch (error) {
        trackEvent("org_created", { success: false });
        const { message } = parseRpcError(error, "Failed to create workspace");
        toastManager.add({
          title: message,
          type: "error",
        });
        // The free plan includes one workspace: send users at the limit
        // to billing so they can upgrade instead of retrying the form.
        if (
          existingOrganizationId &&
          message.toLowerCase().includes("workspace")
        ) {
          navigate({
            to: "/$organizationId/settings/billing",
            params: { organizationId: existingOrganizationId },
          });
        }
        return;
      }
    },
  });

  return (
    <RegisterShell>
      <Card>
        <CardHeader>
          <CardTitle>Create a new Workspace</CardTitle>
          <CardDescription>
            {existingOrganizationId ? (
              <>
                The free plan includes 3 workspaces.{" "}
                <Link
                  params={{ organizationId: existingOrganizationId }}
                  to="/$organizationId/settings/billing"
                >
                  Upgrade
                </Link>{" "}
                to create more.
              </>
            ) : (
              "create a new workspace to get started"
            )}
          </CardDescription>
        </CardHeader>

        <CardPanel>
          <form
            className="flex flex-col gap-5"
            id="register-form"
            onSubmit={(e) => {
              e.preventDefault();
              e.stopPropagation();
              form.handleSubmit();
            }}
          >
            <RegisterShell.Body>
              <RegisterWorkspaceStep form={form} />
            </RegisterShell.Body>
          </form>
        </CardPanel>
      </Card>

      <form.Subscribe
        selector={(state) => state.isSubmitting || !state.canSubmit}
      >
        {(isDisabled) => (
          <Button
            className="w-full"
            disabled={isDisabled}
            form="register-form"
            size="lg"
            type="submit"
          >
            Create Workspace
          </Button>
        )}
      </form.Subscribe>
    </RegisterShell>
  );
}
