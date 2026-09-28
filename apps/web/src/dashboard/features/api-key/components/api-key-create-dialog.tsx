import { useAtomSet } from "@effect/atom-react";
import { Button } from "@feeblo/ui/button";
import { Checkbox } from "@feeblo/ui/checkbox";
import { CheckboxGroup } from "@feeblo/ui/checkbox-group";
import { Field, FieldDescription, FieldLabel } from "@feeblo/ui/field";
import { useAppForm } from "@feeblo/ui/hooks/form";
import { Label } from "@feeblo/ui/label";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "@feeblo/ui/select";
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
import { trackEvent } from "@feeblo/web-shared/analytics-provider";
import { useSelector } from "@xstate/store-react";

import { useOrganizationId } from "~/hooks/use-organization-id";

import { apiKeyReactivityKeys, createApiKeyAtom } from "../atoms";
import { useApiKeyCreateDialogContext } from "../dialog-stores";
import {
  API_KEY_CAPABILITY_GROUP_ITEMS,
  API_KEY_EXPIRATION_ITEMS,
  API_KEY_READ_ONLY_DESCRIPTION,
  apiKeyFormOpts,
  apiKeyScopes,
  toApiKeyCapabilityGroups,
} from "../shared-form";

export type CreatedApiKey = {
  /** Plaintext key, returned by the server exactly once. */
  key: string;
  name: string;
};

export function ApiKeyCreateDialog({
  onCreated,
}: {
  onCreated?: (created: CreatedApiKey) => void | Promise<void>;
}) {
  const store = useApiKeyCreateDialogContext();
  const open = useSelector(store, (state) => state.context.open);

  return (
    <Sheet
      onOpenChange={(open) =>
        // Dispatch the reported open value: this dialog carries no data.
        store.send({ type: "setOpen", open, data: {} })
      }
      open={open}
    >
      <SheetPopup>
        <SheetHeader>
          <SheetTitle>Create API key</SheetTitle>
          <SheetDescription>
            The key is shown once, when it is created, and cannot be retrieved
            again. Name it after the integration that will use it.
          </SheetDescription>
        </SheetHeader>
        {/* Mount the form only while the sheet is open so it resets on every
        open. */}
        {open ? <ApiKeyCreateForm onCreated={onCreated} /> : null}
      </SheetPopup>
    </Sheet>
  );
}

function ApiKeyCreateForm({
  onCreated,
}: {
  onCreated?: (created: CreatedApiKey) => void | Promise<void>;
}) {
  const organizationId = useOrganizationId();
  const store = useApiKeyCreateDialogContext();
  const createApiKey = useAtomSet(createApiKeyAtom, { mode: "promise" });

  const form = useAppForm({
    ...apiKeyFormOpts,
    onSubmit: async ({ value }) => {
      try {
        const created = await createApiKey({
          payload: {
            name: value.name.trim(),
            organizationId,
            expiration: value.expiration,
            scopes: apiKeyScopes(value.capabilities),
          },
          reactivityKeys: apiKeyReactivityKeys(organizationId),
        });
        trackEvent("api_key_created", { success: true });
        form.reset();
        store.send({ type: "toggle" });
        await onCreated?.({ key: created.key, name: value.name.trim() });
      } catch {
        trackEvent("api_key_created", { success: false });
        toastManager.add({ title: "Could not create API key", type: "error" });
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
          {(field) => (
            <field.TextField label="Name" placeholder="Production sync" />
          )}
        </form.AppField>
        <form.AppField name="expiration">
          {(field) => (
            <Field name={field.name}>
              <FieldLabel>Expiration</FieldLabel>
              <Select
                items={API_KEY_EXPIRATION_ITEMS}
                onValueChange={(value) =>
                  // Base UI can report a cleared selection as null; the form
                  // has no empty state, so fall back to the default.
                  field.handleChange(value ?? "never")
                }
                value={field.state.value}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectPopup>
                  {API_KEY_EXPIRATION_ITEMS.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
              <FieldDescription>
                The key stops working after this. You can revoke it sooner at
                any time.
              </FieldDescription>
            </Field>
          )}
        </form.AppField>
        <form.AppField name="capabilities">
          {(field) => (
            <Field name={field.name}>
              <FieldLabel>Access</FieldLabel>
              <CheckboxGroup
                onValueChange={(values) =>
                  field.handleChange(toApiKeyCapabilityGroups(values))
                }
                value={field.state.value}
              >
                {API_KEY_CAPABILITY_GROUP_ITEMS.map((item) => {
                  // The label is the checkbox's next sibling, which is how Base
                  // UI's non-native control finds the label that names it; the
                  // description is referenced separately so it describes the
                  // checkbox instead of becoming part of its name.
                  const id = `api-key-${item.value}`;
                  return (
                    <div className="grid gap-0.5" key={item.value}>
                      <div className="flex items-center gap-2.5">
                        <Checkbox
                          aria-describedby={`${id}-description`}
                          id={id}
                          value={item.value}
                        />
                        <Label htmlFor={id}>{item.label}</Label>
                      </div>
                      <span
                        className="text-muted-foreground ps-7 text-xs/4.5"
                        id={`${id}-description`}
                      >
                        {item.description}
                      </span>
                    </div>
                  );
                })}
              </CheckboxGroup>
              <FieldDescription>
                {API_KEY_READ_ONLY_DESCRIPTION}
              </FieldDescription>
            </Field>
          )}
        </form.AppField>
      </SheetPanel>
      <SheetFooter>
        <SheetClose render={<Button variant="ghost" />}>Cancel</SheetClose>
        <form.AppForm>
          <form.SubscribeButton label="Create key" />
        </form.AppForm>
      </SheetFooter>
    </form>
  );
}
