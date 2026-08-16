import { createLazyRoute } from "@tanstack/react-router";
import { Home } from "../features/home/home";

export const Route = createLazyRoute("/")({
  component: HomePage,
});

function HomePage() {
  return (
    <Home.Provider>
      <Home.Root />
    </Home.Provider>
  );
}
