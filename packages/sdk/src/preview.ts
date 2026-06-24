import { Feeblo, type UserIdentity } from "./index";

const params = new URLSearchParams(window.location.search);

const organizationId = params.get("org") ?? "demo-org";
const baseUrl = params.get("baseUrl") ?? "http://localhost:3001";
const theme = params.get("theme") ?? undefined;

const userId = params.get("userId") ?? undefined;
const user: UserIdentity | undefined = userId
  ? {
      id: userId,
      email: params.get("email") ?? undefined,
      firstName: params.get("firstName") ?? undefined,
      lastName: params.get("lastName") ?? undefined,
      avatar: params.get("avatar") ?? undefined,
    }
  : undefined;

Feeblo.on("*", (e) => {
  const { data, type, namespace } = e.detail;
  console.debug("[Preview] widget event", { data, type, namespace });
});

Feeblo.init(organizationId, {
  baseUrl,
  theme,
  user,
  root: document.getElementById("embed-root") ?? undefined,
  onHeightChange(height) {
    console.debug("[Preview] embed height changed", height);
  },
  onError(error) {
    console.error("[Preview] embed error", error);
  },
});
