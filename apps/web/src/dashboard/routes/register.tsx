import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { Button } from "~/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { toastManager } from "~/components/ui/toast";
import { RegisterShell } from "~/features/register/components/register-shell";
import { RegisterWorkspaceStep } from "~/features/register/components/register-workspace-step";
import { useAppForm } from "~/hooks/form";
import { authClient } from "~/lib/auth-client";
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
  const { refetch } = authClient.useSession();

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
      } catch (_error) {
        toastManager.add({
          title: "Failed to create workspace",
          type: "error",
        });
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
            create a new workspace to get started
          </CardDescription>
        </CardHeader>

        <CardContent>
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
        </CardContent>
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
