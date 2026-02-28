import { VITE_API_URL } from "astro:env/client";
import { createSvelteAuthClient } from "@feeblo/auth/client";

const baseUrl = VITE_API_URL?.endsWith("/") ? VITE_API_URL : `${VITE_API_URL}/`;

export const authClient = createSvelteAuthClient(baseUrl);
