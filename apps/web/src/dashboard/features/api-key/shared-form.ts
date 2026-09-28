import {
  API_KEY_EXPIRATIONS,
  type TApiKeyExpiration,
} from "@feeblo/domain/api-key/schema";
import {
  PUBLIC_API_COMPANY_MANAGEMENT_SCOPES,
  PUBLIC_API_DEFAULT_SCOPES,
  PUBLIC_API_TAG_MANAGEMENT_SCOPES,
  type PublicApiScope,
} from "@feeblo/domain/public-api/scopes";
import { formOptions } from "@tanstack/react-form";
import { z } from "zod";

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

/**
 * The capabilities the create sheet offers on top of the read scopes.
 *
 * One toggle per capability rather than one "access level": the server's
 * grants are per resource, and a single select would have to enumerate every
 * combination of them — including the one the next integration needs, which is
 * the one nobody wrote down. Tags are a group of writes on top of a read scope
 * every key already has; companies are all four actions, because a key minted
 * to read feedback does not learn the workspace's customers by default either.
 *
 * The names are UI vocabulary; the wire carries the scope list in
 * `API_KEY_CAPABILITY_GROUP_SCOPES`, so the two cannot drift.
 */
export const API_KEY_CAPABILITY_GROUPS = ["tags", "companies"] as const;

export type ApiKeyCapabilityGroup = (typeof API_KEY_CAPABILITY_GROUPS)[number];

/**
 * The scopes behind each capability, built from the domain vocabulary rather
 * than restated, so a capability cannot offer a scope the server does not know
 * or miss one it now grants by default.
 */
export const API_KEY_CAPABILITY_GROUP_SCOPES = {
  tags: PUBLIC_API_TAG_MANAGEMENT_SCOPES,
  companies: PUBLIC_API_COMPANY_MANAGEMENT_SCOPES,
} satisfies Record<ApiKeyCapabilityGroup, readonly PublicApiScope[]>;

export const API_KEY_CAPABILITY_GROUP_LABELS = {
  tags: "Manage tags",
  companies: "Manage companies",
} satisfies Record<ApiKeyCapabilityGroup, string>;

export const API_KEY_CAPABILITY_GROUP_DESCRIPTIONS = {
  tags: "Create, rename, and delete tags, and set which tags a post carries. Deleting a tag removes it from every post that carries it.",
  companies:
    "Read, create, update, and delete this workspace's companies. The contacts who belong to a company are not exposed, and deleting one leaves those contacts in place.",
} satisfies Record<ApiKeyCapabilityGroup, string>;

export const API_KEY_CAPABILITY_GROUP_ITEMS = API_KEY_CAPABILITY_GROUPS.map(
  (value) => ({
    value,
    label: API_KEY_CAPABILITY_GROUP_LABELS[value],
    description: API_KEY_CAPABILITY_GROUP_DESCRIPTIONS[value],
  })
);

/**
 * The checkbox group's values, narrowed back to the vocabulary above.
 *
 * Filters rather than casts: the group reports `string[]` because it is
 * value-agnostic, and the only options rendered come from
 * `API_KEY_CAPABILITY_GROUPS`, so this both checks that and gives the form its
 * own type without a SAFETY comment to maintain.
 */
export const toApiKeyCapabilityGroups = (
  values: readonly string[]
): ApiKeyCapabilityGroup[] =>
  API_KEY_CAPABILITY_GROUPS.filter((group) => values.includes(group));

/**
 * The scopes a key is created with: the read default plus whatever the sheet
 * was asked for. Deduplicated because the plugin stores the list verbatim and
 * a repeated action would show up twice in the dashboard — the server
 * deduplicates for the same reason.
 */
export const apiKeyScopes = (
  capabilities: readonly ApiKeyCapabilityGroup[]
): PublicApiScope[] => [
  ...new Set([
    ...PUBLIC_API_DEFAULT_SCOPES,
    ...capabilities.flatMap(
      (capability) => API_KEY_CAPABILITY_GROUP_SCOPES[capability]
    ),
  ]),
];

/**
 * What every key can do before a capability is chosen, so the field can say
 * what the empty state means instead of leaving it to the description of a
 * group the caller may not select.
 */
export const API_KEY_READ_ONLY_DESCRIPTION =
  "Every key reads posts and tags. Select a capability to grant more.";

/**
 * Mirrors the server's `ApiKeyCreate` payload: a name between 1 and 32
 * characters, one of the lifetimes from the domain vocabulary, and any subset
 * of the capabilities above. The server keeps the same bounds, so this is a
 * courtesy check rather than the enforcement point.
 */
export const apiKeyFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Enter a name for the key")
    .max(32, "Use 32 characters or fewer"),
  expiration: z.enum(API_KEY_EXPIRATIONS),
  capabilities: z.array(z.enum(API_KEY_CAPABILITY_GROUPS)),
});

export type ApiKeyFormValues = z.infer<typeof apiKeyFormSchema>;

/**
 * No capability chosen, typed as the vocabulary rather than as an empty array.
 *
 * A bare `[]` infers `never[]`, which then narrows the form's own value type
 * and rejects the validator above it.
 */
const API_KEY_DEFAULT_CAPABILITIES: ApiKeyCapabilityGroup[] = [];

export const apiKeyFormOpts = formOptions({
  defaultValues: {
    name: "",
    // SAFETY: The upstream source guarantees one of these values; the cast bridges an untyped API.
    expiration: "never" as TApiKeyExpiration,
    // No capability is the default: a key that only needs to read should not
    // be able to delete a workspace's tags, or learn its customers, because
    // the sheet opened here.
    capabilities: API_KEY_DEFAULT_CAPABILITIES,
  },
  validators: {
    onSubmit: apiKeyFormSchema,
  },
});
