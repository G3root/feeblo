import { VITE_API_URL } from "astro:env/client";
import { createAuthClient } from "@feeblo/auth/client";

const baseUrl = VITE_API_URL?.endsWith("/") ? VITE_API_URL : `${VITE_API_URL}/`;

export const authClient = createAuthClient(baseUrl);
