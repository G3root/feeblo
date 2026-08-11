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
      onValueChange={(values) => onChange(values as WebhookEventType[])}
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
  render: ({ form }) => (
    <form.AppField
      children={(field) => (
        <Field name={field.name}>
          <FieldLabel>Events</FieldLabel>
          <WebhookEventSelection
            eventTypes={field.state.value}
            idPrefix="create-webhook"
            onChange={(eventTypes) => field.handleChange(eventTypes)}
          />
        </Field>
      )}
      name="eventTypes"
    />
  ),
});
