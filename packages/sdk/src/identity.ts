import { EmbedError } from "./errors";
import type {
  NormalizedUserIdentity,
  UserIdentity,
  WidgetCompany,
  WidgetFieldValue,
} from "./types";

const COMPANY_KEYS = ["id", "name", "avatar", "customFields"] as const;

function normalizeCompany(
  company: WidgetCompany
): Pick<WidgetCompany, "id" | "name" | "avatar" | "customFields"> {
  const result: Record<string, WidgetFieldValue> = {};
  for (const key of COMPANY_KEYS) {
    if (company[key] !== undefined) {
      result[key] = company[key];
    }
  }
  // SAFETY: The runtime invariant checked by the surrounding code guarantees this type.
  return result as Pick<
    WidgetCompany,
    "id" | "name" | "avatar" | "customFields"
  >;
}

export function normalizeUserIdentity(
  user: UserIdentity
): NormalizedUserIdentity {
  const { id, ...rest } = user;
  if (!id) {
    throw new EmbedError({
      code: "INVALID_IDENTITY",
      message: "[feeblo-sdk] `id` is required to identify a widget user.",
    });
  }

  const base: Record<string, WidgetFieldValue> = {};
  for (const key of [
    "email",
    "name",
    "avatar",
    "token",
    "customFields",
  ] as const) {
    if (rest[key] !== undefined) {
      base[key] = rest[key];
    }
  }

  const companies = rest.companies?.map(normalizeCompany);
  // SAFETY: The runtime invariant checked by the surrounding code guarantees this type.
  return {
    id,
    ...base,
    ...(companies && { companies }),
  } as NormalizedUserIdentity;
}
