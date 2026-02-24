import { Tick02Icon, UnfoldMoreIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useLiveSuspenseQuery } from "@tanstack/react-db";
import { Suspense } from "react";
import { membershipCollection } from "~/lib/collections";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "../ui/sidebar";

export function OrganizationSwitcher() {
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={(props) => (
              <SidebarMenuButton
                {...props}
                className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
                size="lg"
              >
                <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                  {/* <HugeiconsIcon className="size-4" icon={Command} /> */}
                </div>
                <div className="flex flex-col gap-0.5 leading-none">
                  <span className="font-medium">Organization</span>
                  {/* <span className="">v{selectedVersion}</span> */}
                </div>
                <HugeiconsIcon className="ml-auto" icon={UnfoldMoreIcon} />
              </SidebarMenuButton>
            )}
          />
          <DropdownMenuContent align="start">
            <Suspense>
              <OrganizationList />
            </Suspense>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

const OrganizationList = () => {
  const { data } = useLiveSuspenseQuery((q) =>
    q
      .from({ membership: membershipCollection })
      .orderBy((membership) => membership.membership.createdAt, "desc")
  );

  return data.map((membership) => (
    <DropdownMenuItem key={membership.id}>
      {membership.organization.name}

      <HugeiconsIcon className="ml-auto" icon={Tick02Icon} />
    </DropdownMenuItem>
  ));
};
