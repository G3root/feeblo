import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
} from "@feeblo/ui/menu";
import { UserAvatar } from "@feeblo/ui/user-avatar";
import { authClient } from "@feeblo/web-shared/auth-client";
import { useAuth } from "@feeblo/web-shared/auth-context";
import { refreshAuthSession } from "@feeblo/web-shared/auth-session";
import { LogoutSquare01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

export function UserMenu() {
  const auth = useAuth();
  const user = auth.status === "authenticated" ? auth.user : null;

  if (!user) {
    return null;
  }

  return (
    <Menu>
      <MenuTrigger className="bg-background hover:bg-accent hover:text-accent-foreground flex items-center gap-2 rounded-full py-1 pr-2 pl-1 transition-colors">
        <UserAvatar image={user.image} name={user.name ?? "CN"} />
      </MenuTrigger>
      <MenuPopup align="end" className="min-w-56 rounded-lg" sideOffset={4}>
        <div className="px-2 py-1.5">
          <p className="text-sm leading-none font-medium">{user.name}</p>
          <p className="text-muted-foreground mt-1 text-xs leading-none">
            {user.email}
          </p>
        </div>
        <MenuSeparator />
        <MenuItem
          onClick={async () => {
            await authClient.signOut();
            await refreshAuthSession();
          }}
        >
          <HugeiconsIcon icon={LogoutSquare01Icon} />
          Log out
        </MenuItem>
      </MenuPopup>
    </Menu>
  );
}
