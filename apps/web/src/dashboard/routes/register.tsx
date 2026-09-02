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
import { useAuthState } from "@feeblo/web-shared/use-auth-state";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { RegisterShell } from "~/features/register/components/register-shell";
import { m } from "@/paraglide/messages";
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
  const { refetch } = useAuthState();

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
            title: m.otter_yarrow_zephyr(),
            type: "success",
          });
          await refetch();
          navigate({
            to: "/$organizationId",
            params: { organizationId: result.organizationId },
          });
          return;
        }
      } catch {
        trackEvent("org_created", { success: false });
        toastManager.add({
          title: m.glacier_indigo_summit(),
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
          <CardTitle>{m.kettle_ledge_rustic()}</CardTitle>
          <CardDescription>{m.cobalt_heath_thicket()}</CardDescription>
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
            {m.crimson_tide_willow()}
          </Button>
        )}
      </form.Subscribe>
    </RegisterShell>
  );
}
