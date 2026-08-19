import { useAtomSet } from "@effect/atom-react";
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
import { z } from "zod";

import { useOrganizationId } from "~/hooks/use-organization-id";

import { updateWebhookEndpointAtom, webhookReactivityKeys } from "../atoms";
import { useWebhookEditSheetContext } from "../dialog-stores";
import { webhookFormOpts, webhookFormSchema } from "../shared-form";
import { WebhookEventSelectionField } from "./webhook-events-selection";

export function WebhookEditSheet() {
  const store = useWebhookEditSheetContext();
  const open = useSelector(store, (state) => state.context.open);
  const endpoint = useSelector(store, (state) => state.context.data.endpoint);

  return (
    <Sheet
      onOpenChange={(open) =>
        // Dispatch the reported open value (not a toggle) and keep the
        // endpoint data so a close never wipes the editing target.
        store.send({ type: "setOpen", open, data: { endpoint } })
      }
      open={open}
    >
      <SheetPopup>
        <SheetHeader>
          <SheetTitle>Edit webhook endpoint</SheetTitle>
          <SheetDescription>
            Update the endpoint name, URL, or subscribed events.
          </SheetDescription>
        </SheetHeader>
        {open ? <WebhookEditForm /> : null}
      </SheetPopup>
    </Sheet>
  );
}

function WebhookEditForm() {
  const organizationId = useOrganizationId();
  const store = useWebhookEditSheetContext();
  const endpoint = useSelector(store, (state) => state.context.data.endpoint);
  const updateEndpoint = useAtomSet(updateWebhookEndpointAtom, {
    mode: "promise",
  });

  const form = useAppForm({
    ...webhookFormOpts,
    defaultValues: {
      endpointUrl: "",
      eventTypes: [...endpoint.eventTypes],
      name: endpoint.name,
    },
    // Unlike creation, the URL is optional when editing: a blank field keeps
    // the current URL, so the shared schema's required URL is relaxed here.
    validators: {
      onSubmit: webhookFormSchema.extend({
        endpointUrl: z.string().trim(),
      }),
    },
    onSubmit: async ({ value }) => {
      try {
        await updateEndpoint({
          payload: {
            connectionId: endpoint.id,
            ...(value.endpointUrl.trim() === ""
              ? undefined
              : { endpointUrl: value.endpointUrl.trim() }),
            eventTypes: [...value.eventTypes],
            name: value.name.trim(),
            organizationId,
          },
          reactivityKeys: webhookReactivityKeys(organizationId),
        });
        form.reset();
        store.send({ type: "toggle" });
        toastManager.add({
          title: "Webhook endpoint updated",
          type: "success",
        });
      } catch {
        toastManager.add({
          title: "Could not update webhook endpoint",
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
        <form.AppField name="name">
          {(field) => <field.TextField label="Name" />}
        </form.AppField>
        <form.AppField name="endpointUrl">
          {(field) => (
            <field.TextField
              label="New URL (optional)"
              placeholder="Leave blank to keep the current URL"
              type="url"
            />
          )}
        </form.AppField>
        <WebhookEventSelectionField form={form} idPrefix="edit-webhook" />
      </SheetPanel>
      <SheetFooter>
        <SheetClose render={<Button variant="ghost" />}>Cancel</SheetClose>
        <form.AppForm>
          <form.SubscribeButton label="Save changes" variant="brand" />
        </form.AppForm>
      </SheetFooter>
    </form>
  );
}
