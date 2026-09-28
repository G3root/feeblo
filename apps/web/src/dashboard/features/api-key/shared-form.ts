import {
  API_KEY_EXPIRATIONS,
  type TApiKeyExpiration,
} from "@feeblo/domain/api-key/schema";
import {
  PUBLIC_API_CHANGELOG_MANAGEMENT_SCOPES,
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
 * The access levels the create sheet offers.
 *
 * `read_only` is the scopes the server grants on its own; the other levels add
 * the Public API's write scopes, which the server never grants without being
 * asked. The names are UI vocabulary — the wire carries the scope list in
 * `API_KEY_ACCESS_LEVEL_SCOPES`, so the two cannot drift. Changelog and tag
 * management are separate choices rather than one, because a key that keeps a
 * workspace's vocabulary tidy has no business broadcasting release notes, and
 * `content_management` is the deliberate "both" for an integration that does
 * need the whole surface.
 */
export const API_KEY_ACCESS_LEVELS = [
  "read_only",
  "tag_management",
  "changelog_management",
  "content_management",
] as const;

export type ApiKeyAccessLevel = (typeof API_KEY_ACCESS_LEVELS)[number];

/**
 * The scopes behind each level, built from the domain vocabulary rather than
 * restated, so a level cannot offer a scope the server does not know or miss
 * one it now grants by default.
 */
export const API_KEY_ACCESS_LEVEL_SCOPES = {
  read_only: PUBLIC_API_DEFAULT_SCOPES,
  tag_management: [
    ...PUBLIC_API_DEFAULT_SCOPES,
    ...PUBLIC_API_TAG_MANAGEMENT_SCOPES,
  ],
  changelog_management: [
    ...PUBLIC_API_DEFAULT_SCOPES,
    ...PUBLIC_API_CHANGELOG_MANAGEMENT_SCOPES,
  ],
  content_management: [
    ...PUBLIC_API_DEFAULT_SCOPES,
    ...PUBLIC_API_TAG_MANAGEMENT_SCOPES,
    ...PUBLIC_API_CHANGELOG_MANAGEMENT_SCOPES,
  ],
} satisfies Record<ApiKeyAccessLevel, readonly PublicApiScope[]>;

export const API_KEY_ACCESS_LEVEL_LABELS = {
  read_only: "Read only",
  tag_management: "Read and manage tags",
  changelog_management: "Read and manage changelog",
  content_management: "Read and manage tags and changelog",
} satisfies Record<ApiKeyAccessLevel, string>;

export const API_KEY_ACCESS_LEVEL_DESCRIPTIONS = {
  read_only: "Can read this workspace's posts, tags, and changelog entries.",
  tag_management:
    "Can also create, rename, and delete tags, and set which tags a post carries. Deleting a tag removes it from every post that carries it.",
  changelog_management:
    "Can also create, edit, and delete changelog entries, and publish them. Publishing emails everyone subscribed to the changelog.",
  content_management:
    "Tag management plus changelog management: create, edit, and delete tags and changelog entries, assign tags, and publish release notes.",
} satisfies Record<ApiKeyAccessLevel, string>;

export const API_KEY_ACCESS_LEVEL_ITEMS = API_KEY_ACCESS_LEVELS.map(
  (value) => ({
    label: API_KEY_ACCESS_LEVEL_LABELS[value],
    value,
  })
);

/**
 * Mirrors the server's `ApiKeyCreate` payload: a name between 1 and 32
 * characters, one of the lifetimes from the domain vocabulary, and one of the
 * access levels above. The server keeps the same bounds, so this is a courtesy
 * check rather than the enforcement point.
 */
export const apiKeyFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Enter a name for the key")
    .max(32, "Use 32 characters or fewer"),
  expiration: z.enum(API_KEY_EXPIRATIONS),
  access: z.enum(API_KEY_ACCESS_LEVELS),
});

export type ApiKeyFormValues = z.infer<typeof apiKeyFormSchema>;

export const apiKeyFormOpts = formOptions({
  defaultValues: {
    name: "",
    // SAFETY: The upstream source guarantees one of these values; the cast bridges an untyped API.
    expiration: "never" as TApiKeyExpiration,
    // The narrower grant is the default: a key that only needs to read should
    // not be able to delete a workspace's tags because the sheet opened here.
    // SAFETY: The upstream source guarantees one of these values; the cast bridges an untyped API.
    access: "read_only" as ApiKeyAccessLevel,
  },
  validators: {
    onSubmit: apiKeyFormSchema,
  },
});
