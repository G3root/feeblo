import { init } from "./index";

const params = new URLSearchParams(window.location.search);

const organizationId = params.get("org") ?? "demo-org";
const baseUrl = params.get("baseUrl") ?? "http://localhost:3001";
const theme = params.get("theme") ?? undefined;

init(organizationId, {
  baseUrl,
  theme,
  root: document.getElementById("embed-root") ?? undefined,
  onHeightChange(height) {
    console.debug("[Preview] embed height changed", height);
  },
  onError(error) {
    console.error("[Preview] embed error", error);
  },
});
