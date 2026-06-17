import { RouterProvider } from "@tanstack/react-router";
import { createWidgetRouter } from "./router";

export interface WidgetAppProps {
  initialRoute?: string;
}

export function WidgetApp({ initialRoute = "/updates" }: WidgetAppProps) {
  const router = createWidgetRouter(initialRoute);
  return <RouterProvider router={router} />;
}
