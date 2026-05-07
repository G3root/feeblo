import { createAuthClient } from "@feeblo/auth/client";
import { getServerRuntimePublicEnv } from "./server-runtime-public-env";

const API_URL = getServerRuntimePublicEnv().apiUrl;

const baseUrl = API_URL?.endsWith("/") ? API_URL : `${API_URL}/`;

export const authClient = createAuthClient(baseUrl);
