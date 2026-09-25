import {
  API_KEY_EXPIRATIONS,
  type TApiKeyExpiration,
} from "@feeblo/domain/api-key/schema";
import { formOptions } from "@tanstack/react-form";
import { z } from "zod";

/**
 * Mirrors the server's `ApiKeyCreate` payload: a name between 1 and 32
 * characters and one of the lifetimes from the domain vocabulary. The server
 * keeps the same bounds, so this is a courtesy check rather than the
 * enforcement point.
 */
export const apiKeyFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Enter a name for the key")
    .max(32, "Use 32 characters or fewer"),
  expiration: z.enum(API_KEY_EXPIRATIONS),
});

export type ApiKeyFormValues = z.infer<typeof apiKeyFormSchema>;

/**
 * Select labels for the lifetimes in `API_KEY_EXPIRATIONS`. The record is
 * keyed by the domain vocabulary, so adding a choice there without a label
 * here is a type error.
 */
export const API_KEY_EXPIRATION_LABELS = {
  "7d": "7 days",
  "30d": "30 days",
  "3m": "3 months",
  "1y": "1 year",
  never: "Never expires",
} satisfies Record<TApiKeyExpiration, string>;

/**
 * The select's `items`, so the trigger renders the label ("7 days") instead of
 * the stored value ("7d"). Derived from the vocabulary above, never written
 * out by hand.
 */
export const API_KEY_EXPIRATION_ITEMS = API_KEY_EXPIRATIONS.map((value) => ({
  label: API_KEY_EXPIRATION_LABELS[value],
  value,
}));

export const apiKeyFormOpts = formOptions({
  defaultValues: {
    name: "",
    // SAFETY: The upstream source guarantees one of these values; the cast bridges an untyped API.
    expiration: "never" as TApiKeyExpiration,
  },
  validators: {
    onSubmit: apiKeyFormSchema,
  },
});
