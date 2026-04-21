import { TanStackDevtools } from "@tanstack/react-devtools";
import { createRootRoute, Outlet } from "@tanstack/react-router";

const RootLayout = () => (
  <>
    <Outlet />
    <TanStackDevtools
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
    />
  </>
);

export const Route = createRootRoute({ component: RootLayout });
