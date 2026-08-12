import { SUBSCRIBABLE_INTEGRATION_EVENT_TYPES } from "@feeblo/db/validation-schema/integration";
import { formOptions } from "@tanstack/react-form";
import { z } from "zod";

// Single source of truth: the canonical subscribable event vocabulary owned by
// the integration persistence schema. The dashboard consumes it directly so a
// new event type surfaces in the UI without a parallel constant to update.
export const webhookEventTypes = [
  ...SUBSCRIBABLE_INTEGRATION_EVENT_TYPES,
] as const;

export type WebhookEventType = (typeof webhookEventTypes)[number];

export const webhookFormSchema = z.object({
  name: z.string().trim().min(1, "Enter an endpoint name"),
  endpointUrl: z
    .string()
    .trim()
    .min(1, "Enter an endpoint URL")
    .pipe(z.url("Enter a valid endpoint URL")),
  eventTypes: z
    .array(z.enum(webhookEventTypes))
    .min(1, "Select at least one event"),
});

export type WebhookFormValues = z.infer<typeof webhookFormSchema>;

export const webhookFormOpts = formOptions({
  defaultValues: {
    name: "",
    endpointUrl: "",
    eventTypes: [...webhookEventTypes],
  },
  validators: {
    onSubmit: webhookFormSchema,
  },
});
