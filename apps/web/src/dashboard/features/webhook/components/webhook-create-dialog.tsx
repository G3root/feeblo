import { Button } from "@feeblo/ui/button";
import { useAppForm } from "@feeblo/ui/hooks/form";
import {
  Sheet,
  SheetClose,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetPanel,
  SheetPopup,
  SheetTitle,
} from "@feeblo/ui/sheet";
import { toastManager } from "@feeblo/ui/toast";
import { useSelector } from "@xstate/store-react";
import { useOrganizationId } from "~/hooks/use-organization-id";
import { fetchRpc } from "~/lib/runtime";
import { useWebhookCreateDialogContext } from "../dialog-stores";
import { webhookFormOpts } from "../shared-form";
import { WebhookEventSelectionField } from "./webhook-events-selection";

export type CreatedWebhookEndpoint = {
  endpointName: string;
  signingSecret: string;
};

export function WebhookCreateDialog({
  onCreated,
}: {
  onCreated?: (endpoint: CreatedWebhookEndpoint) => void | Promise<void>;
}) {
  const store = useWebhookCreateDialogContext();
  const open = useSelector(store, (state) => state.context.open);

  return (
    <Sheet onOpenChange={() => store.send({ type: "toggle" })} open={open}>
      <SheetPopup>
        <SheetHeader>
          <SheetTitle>Create webhook endpoint</SheetTitle>
          <SheetDescription>
            Feeblo validates the address before saving and signs every request.
          </SheetDescription>
        </SheetHeader>
        <WebhookCreateForm onCreated={onCreated} />
      </SheetPopup>
    </Sheet>
  );
}

function WebhookCreateForm({
  onCreated,
}: {
  onCreated?: (endpoint: CreatedWebhookEndpoint) => void | Promise<void>;
}) {
  const organizationId = useOrganizationId();
  const store = useWebhookCreateDialogContext();

  const form = useAppForm({
    ...webhookFormOpts,
    onSubmit: async ({ value }) => {
      try {
        const result = await fetchRpc((rpc) =>
          rpc.WebhookEndpointCreate({
            endpointUrl: value.endpointUrl,
            eventTypes: [...value.eventTypes],
            name: value.name,
            organizationId,
          })
        );
        form.reset();
        store.send({ type: "toggle" });
        await onCreated?.({
          endpointName: result.endpoint.name,
          signingSecret: result.signingSecret,
        });
      } catch {
        toastManager.add({
          title: "Could not create webhook endpoint",
          type: "error",
        });
      }
    },
  });

  return (
    <form
      className="contents"
      data-slot="form"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        form.handleSubmit();
      }}
    >
      <SheetPanel className="grid gap-4">
        <form.AppField
          children={(field) => <field.TextField label="Name" />}
          name="name"
        />
        <form.AppField
          children={(field) => (
            <field.TextField
              label="Endpoint URL"
              placeholder="https://example.com/hooks/feeblo"
              type="url"
            />
          )}
          name="endpointUrl"
        />
        <WebhookEventSelectionField form={form} />
      </SheetPanel>
      <SheetFooter>
        <SheetClose render={<Button variant="ghost" />}>Cancel</SheetClose>
        <form.AppForm>
          <form.SubscribeButton label="Create endpoint" />
        </form.AppForm>
      </SheetFooter>
    </form>
  );
}
