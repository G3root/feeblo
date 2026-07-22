import { Avatar, AvatarFallback } from "@feeblo/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@feeblo/ui/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@feeblo/ui/sidebar";
import { useTheme } from "@feeblo/ui/theme-provider";
import { authClient } from "@feeblo/web-shared/auth-client";
import { refreshAuthSession } from "@feeblo/web-shared/auth-session";
import { useAuthState } from "@feeblo/web-shared/use-auth-state";
import {
  CreditCardIcon,
  LogoutSquare01Icon,
  Moon02Icon,
  Sun01Icon,
  UnfoldMoreIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useOrganizationId } from "~/hooks/use-organization-id";

export function NavUser() {
  const { isMobile } = useSidebar();
  const { data: session } = useAuthState();
  const navigate = useNavigate();
  const organizationId = useOrganizationId();
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <SidebarMenuButton
                className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
                size="lg"
              />
            }
          >
            <Avatar className="h-8 w-8 rounded-lg">
              {/* <AvatarImage src={user.avatar} alt={user.name} /> */}
              <AvatarFallback className="rounded-lg">CN</AvatarFallback>
            </Avatar>
            <div className="grid flex-1 text-left text-sm leading-tight">
              <span className="truncate font-medium">
                {session?.user?.name}
              </span>
              <span className="truncate text-xs">{session?.user?.email}</span>
            </div>
            <HugeiconsIcon className="ml-auto size-4" icon={UnfoldMoreIcon} />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
            side={isMobile ? "bottom" : "right"}
            sideOffset={4}
          >
            <DropdownMenuItem
              nativeButton={false}
              render={(props) => (
                <Link
                  {...props}
                  params={{ organizationId }}
                  to="/$organizationId/settings/billing"
                >
                  <HugeiconsIcon icon={CreditCardIcon} />
                  Billing
                </Link>
              )}
            />
            <ThemeMenu />
            <DropdownMenuSeparator />

            <DropdownMenuItem
              onClick={async () => {
                await authClient.signOut();
                await refreshAuthSession();
                await navigate({ to: "/sign-in" });
              }}
            >
              <HugeiconsIcon icon={LogoutSquare01Icon} />
              Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

function ThemeMenu() {
  const { themeMode, setTheme } = useTheme();
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <HugeiconsIcon icon={themeMode === "dark" ? Moon02Icon : Sun01Icon} />
        Theme
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        <DropdownMenuRadioGroup
          onValueChange={(value) =>
            setTheme(value as "light" | "dark" | "auto")
          }
          value={themeMode}
        >
          <DropdownMenuRadioItem value="light">Light</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark">Dark</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="auto">System</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
