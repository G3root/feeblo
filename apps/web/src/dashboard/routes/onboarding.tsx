/** biome-ignore-all lint/style/noNestedTernary: <explanation> */
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
import { OnboardingShell } from "~/features/onboarding/components/onboarding-shell";
import { OnboardingWorkspaceStep } from "~/features/onboarding/components/onboarding-workspace-step";
import { useAppForm } from "~/hooks/form";
import { authClient } from "~/lib/auth-client";
import { fetchRpc } from "~/lib/runtime";
import { onboardingFormOpts } from "../features/onboarding/shared-form";

const SearchSchema = z.object({
  redirectTo: z.string().optional(),
});

export const Route = createFileRoute("/onboarding")({
  validateSearch: (search) => SearchSchema.parse(search),
  component: OnboardingRoute,
});

function OnboardingRoute() {
  const navigate = Route.useNavigate();
  const { refetch } = authClient.useSession();

  const form = useAppForm({
    ...onboardingFormOpts,
    onSubmit: async ({ value }) => {
      try {
        const result = await fetchRpc((rpc) =>
          rpc.OnboardingComplete({
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
          title: "Failed to complete onboarding",
          type: "error",
        });
        return;
      }
    },
  });

  return (
    <OnboardingShell>
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
            id="onboarding-form"
            onSubmit={(e) => {
              e.preventDefault();
              e.stopPropagation();
              form.handleSubmit();
            }}
          >
            <OnboardingShell.Body>
              <OnboardingWorkspaceStep form={form} />
            </OnboardingShell.Body>
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
            form="onboarding-form"
            size="lg"
            type="submit"
          >
            Create Workspace
          </Button>
        )}
      </form.Subscribe>
    </OnboardingShell>
  );
}
