import { EmbedError } from "./errors";
import type {
  NormalizedUserIdentity,
  UserIdentity,
  WidgetCompany,
} from "./types";

const COMPANY_KEYS = ["id", "name", "avatar", "customFields"] as const;

function normalizeCompany(
  company: WidgetCompany
): Pick<WidgetCompany, "id" | "name" | "avatar" | "customFields"> {
  const result = Object.fromEntries(
    COMPANY_KEYS.flatMap((key) =>
      company[key] === undefined ? [] : [[key, company[key]] as const]
    )
  );

  // SAFETY: `COMPANY_KEYS` is exactly the picked key set, and every present
  // value keeps its `WidgetCompany` type.
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

  const base = Object.fromEntries(
    (["email", "name", "avatar", "token", "customFields"] as const).flatMap(
      (key) => (rest[key] === undefined ? [] : [[key, rest[key]] as const])
    )
  );

  const companies = rest.companies?.map(normalizeCompany);

  // SAFETY: The runtime invariant checked by the surrounding code guarantees this type.
  return {
    id,
    ...base,
    ...(companies && { companies }),
  } as NormalizedUserIdentity;
}
