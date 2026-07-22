import { AuthProvider } from "@feeblo/web-shared/auth-context";
import type { AuthHint } from "@feeblo/web-shared/auth-hint";
import { RouterProvider } from "@tanstack/react-router";
import { createRouter } from "./router";

const router = createRouter();

export const Dashboard = ({ initialHint }: { initialHint?: AuthHint | null }) => (
  <AuthProvider initialHint={initialHint}>
    <RouterProvider router={router} />
  </AuthProvider>
);
