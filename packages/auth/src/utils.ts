import { Effect } from "effect";
import { AuthConfig } from "./config";

const makeTrustedOrigins = Effect.fnUntraced(function* () {
  const { trustedOrigins, apiUrl, appUrl } = yield* AuthConfig;
  const origins = trustedOrigins
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

  if (origins.length > 0) {
    return origins;
  }

  return [appUrl, apiUrl, "*.localhost:3001"];
});

export const getTrustedOrigins = makeTrustedOrigins();
