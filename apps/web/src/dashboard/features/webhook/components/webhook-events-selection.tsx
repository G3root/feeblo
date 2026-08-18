import { Checkbox } from "@feeblo/ui/checkbox";
import { CheckboxGroup } from "@feeblo/ui/checkbox-group";
import { Field, FieldLabel } from "@feeblo/ui/field";
import { withForm } from "@feeblo/ui/hooks/form";
import { Label } from "@feeblo/ui/label";
import type { AppFieldExtendedReactFormApi } from "@tanstack/react-form";
import type { ComponentType } from "react";

import {
  type WebhookEventType,
  type WebhookFormValues,
  webhookEventTypes,
  webhookFormOpts,
} from "../shared-form";

export function WebhookEventSelection({
  eventTypes,
  idPrefix,
  onChange,
}: {
  readonly eventTypes: readonly WebhookEventType[];
  readonly idPrefix: string;
  readonly onChange: (eventTypes: WebhookEventType[]) => void;
}) {
  return (
    <CheckboxGroup
      aria-label="Events"
      onValueChange={(values) =>
        // SAFETY: the only checkbox options rendered below come from
        // webhookEventTypes, so every checked value is a WebhookEventType;
        // the group's onChange types them as string[] because CheckboxGroup is
        // value-agnostic.
        // SAFETY: the checkbox group's values are the event-type fields the table renders.
        onChange(values as WebhookEventType[])
      }
      value={[...eventTypes]}
    >
      {webhookEventTypes.map((eventType) => {
        const id = `${idPrefix}-${eventType}`;
        return (
          <div className="flex items-center gap-2" key={eventType}>
            <Checkbox id={id} value={eventType} />
            <Label htmlFor={id}>{eventType}</Label>
          </div>
        );
      })}
    </CheckboxGroup>
  );
}

// The shared schema's `z.url()` pipe and the edit sheet's relaxed override
// produce different validator types, so the exported form prop is widened to
// accept any webhook form (see the file-level suppression comment).
type WebhookEventSelectionFieldProps = {
  readonly form: AppFieldExtendedReactFormApi<
    WebhookFormValues,
    any,
    any,
    any,
    any,
    any,
    any,
    any,
    any,
    any,
    any,
    any,
    any,
    any
  >;
  readonly idPrefix: string;
};

// SAFETY: The upstream contract guarantees a string here.
/** Default id prefix for the event-selection field; consumers override it at mount. */
const webhookIdPrefix: string = "webhook";

export const WebhookEventSelectionField =
  /* SAFETY: withForm returns a component matching the form's props contract; consumers supply the real idPrefix. */
  withForm({
    ...webhookFormOpts,
    // SAFETY: The upstream contract guarantees a string here.
    props: { idPrefix: webhookIdPrefix },
    render: ({ form, idPrefix }) => (
      <form.AppField
        children={(field) => (
          <Field name={field.name}>
            <FieldLabel>Events</FieldLabel>
            <WebhookEventSelection
              eventTypes={field.state.value}
              idPrefix={idPrefix}
              onChange={(eventTypes) => field.handleChange(eventTypes)}
            />
          </Field>
        )}
        name="eventTypes"
      />
    ),
  }) as ComponentType<WebhookEventSelectionFieldProps>;
