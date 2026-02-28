import { A, useLocation } from "@solidjs/router";
import { authClient } from "../../lib/auth-client";
// import { SignInModal } from '../auth/signin-modal';
import { buttonVariants } from "../ui/button";

export function Navbar() {
  const location = useLocation();
  const session = authClient.useSession();

  return (
    <header class="border-b">
      <div class="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 md:px-6">
        <div class="flex items-center gap-8">
          <A class="font-medium" href="/">
            Feedback App
          </A>

          <div class="flex items-center gap-1">
            <A
              class={buttonVariants({
                variant:
                  location.pathname === "/" ||
                  location.pathname.startsWith("/p/")
                    ? "default"
                    : "ghost",
                size: "sm",
              })}
              href="/"
            >
              Feedback
            </A>
            <A
              class={buttonVariants({
                variant:
                  location.pathname === "/roadmap" ||
                  location.pathname.startsWith("/roadmap")
                    ? "default"
                    : "ghost",
                size: "sm",
              })}
              href="/roadmap"
            >
              Roadmap
            </A>
          </div>
        </div>

        <div>
          {/* <Show when={session().data} fallback={<SignInModal />}>
            <Button variant="outline" size="sm">
              Sign Out
            </Button>
          </Show> */}
        </div>
      </div>
    </header>
  );
}
