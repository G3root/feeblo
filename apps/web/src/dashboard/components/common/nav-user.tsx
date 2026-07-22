import { Avatar, AvatarFallback } from "@feeblo/ui/avatar";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
  MenuTrigger,
} from "@feeblo/ui/menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@feeblo/ui/sidebar";
import { useTheme } from "@feeblo/ui/theme-provider";
import { authClient } from "@feeblo/web-shared/auth-client";
import { useAuth } from "@feeblo/web-shared/auth-context";
import { refreshAuthSession } from "@feeblo/web-shared/auth-session";
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
  const auth = useAuth();
  const user = auth.status === "authenticated" ? auth.user : null;
  const navigate = useNavigate();
  const organizationId = useOrganizationId();
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <Menu>
          <MenuTrigger
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
              <span className="truncate font-medium">{user?.name}</span>
              <span className="truncate text-xs">{user?.email}</span>
            </div>
            <HugeiconsIcon className="ml-auto size-4" icon={UnfoldMoreIcon} />
          </MenuTrigger>
          <MenuPopup
            align="end"
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
            side={isMobile ? "bottom" : "right"}
            sideOffset={4}
          >
            <MenuItem
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
            <MenuSeparator />

            <MenuItem
              onClick={async () => {
                await authClient.signOut();
                await refreshAuthSession();
                await navigate({ to: "/sign-in" });
              }}
            >
              <HugeiconsIcon icon={LogoutSquare01Icon} />
              Log out
            </MenuItem>
          </MenuPopup>
        </Menu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

function ThemeMenu() {
  const { themeMode, setTheme } = useTheme();
  return (
    <MenuSub>
      <MenuSubTrigger>
        <HugeiconsIcon icon={themeMode === "dark" ? Moon02Icon : Sun01Icon} />
        Theme
      </MenuSubTrigger>
      <MenuSubPopup>
        <MenuRadioGroup
          onValueChange={(value) =>
            setTheme(value as "light" | "dark" | "auto")
          }
          value={themeMode}
        >
          <MenuRadioItem value="light">Light</MenuRadioItem>
          <MenuRadioItem value="dark">Dark</MenuRadioItem>
          <MenuRadioItem value="auto">System</MenuRadioItem>
        </MenuRadioGroup>
      </MenuSubPopup>
    </MenuSub>
  );
}
