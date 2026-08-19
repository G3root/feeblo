import { createVanillaAuthClient } from "@feeblo/auth/client";

import { getServerRuntimePublicEnv } from "./server-runtime-public-env";

const API_URL = getServerRuntimePublicEnv().apiUrl;

const baseUrl = API_URL?.endsWith("/") ? API_URL : `${API_URL}/`;

// Vanilla better-auth client (no React): the middleware only calls
// `getSession()`, and the React client would drag React into the worker's
// startup module graph.
export const authClient = createVanillaAuthClient(baseUrl);
