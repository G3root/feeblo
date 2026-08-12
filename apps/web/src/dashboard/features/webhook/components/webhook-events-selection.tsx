/** biome-ignore-all lint/suspicious/noExplicitAny: the shared schema validates the endpoint URL with Zod's `z.url()` (a `ZodPipe`), while the edit sheet relaxes that field to `z.string().trim()` so a blank URL keeps the current one; the field component's `form` prop is therefore widened to accept any webhook form. It only renders the eventTypes field and never reads the URL validator. */
import { Checkbox } from "@feeblo/ui/checkbox";
import { CheckboxGroup } from "@feeblo/ui/checkbox-group";
import { Field, FieldLabel } from "@feeblo/ui/field";
import { withForm } from "@feeblo/ui/hooks/form";
import { Label } from "@feeblo/ui/label";
import {
  type WebhookEventType,
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

export const WebhookEventSelectionField = withForm({
  ...webhookFormOpts,
  props: { idPrefix: "webhook" as string },
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
});
