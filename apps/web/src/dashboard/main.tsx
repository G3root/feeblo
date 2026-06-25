import { RouterProvider } from "@tanstack/react-router";
import { createRouter } from "./router";

const router = createRouter();

export const Dashboard = () => <RouterProvider router={router} />;
