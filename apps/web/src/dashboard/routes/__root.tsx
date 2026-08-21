import { createRootRoute, Outlet } from "@tanstack/react-router";

import { dashboardAuthBeforeLoad } from "~/lib/auth-redirects";

const RootLayout = () => (
  <>
    <Outlet />
    {/* <TanStackDevtools
      config={{
        position: "bottom-right",
      }}
      // plugins={[
      //   {
      //     name: "Tanstack Router",
      //     render: <TanStackRouterDevtoolsPanel />,
      //   },

      //   TanStackQueryDevtools,
      //   formDevtoolsPlugin(),
      // ]}
    /> */}
  </>
);

export const Route = createRootRoute({
  component: RootLayout,
  beforeLoad: dashboardAuthBeforeLoad,
});
