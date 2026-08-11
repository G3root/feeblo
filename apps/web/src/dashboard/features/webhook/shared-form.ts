import { formOptions } from "@tanstack/react-form";
import { z } from "zod";

export const webhookEventTypes = [
  "feedback.post.created",
  "feedback.post.status_changed",
] as const;

export type WebhookEventType = (typeof webhookEventTypes)[number];

export const webhookFormSchema = z.object({
  name: z.string().trim().min(1, "Enter an endpoint name"),
  endpointUrl: z.string().trim().min(1, "Enter an endpoint URL"),
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
