import { Badge } from "@feeblo/ui/badge";
import { Button } from "@feeblo/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@feeblo/ui/dropdown-menu";
import { MoreVerticalIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { eq, useLiveQuery } from "@tanstack/react-db";
import { createFileRoute } from "@tanstack/react-router";
import { SettingsItem } from "~/features/settings/components/settings-item";
import { SettingsLayout } from "~/features/settings/components/settings-layout";
import { useOrganizationId } from "~/hooks/use-organization-id";
import { jwtSecretCollection } from "~/lib/collections";

export const Route = createFileRoute("/$organizationId/settings/security")({
  component: RouteComponent,

  beforeLoad: async () => {
    await jwtSecretCollection.preload();
    return null;
  },
});

function formatDate(date: Date): string {
  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function RouteComponent() {
  const organizationId = useOrganizationId();

  const { data: secrets } = useLiveQuery(
    (q) =>
      q
        .from({ secret: jwtSecretCollection })
        .where(({ secret }) => eq(secret.organizationId, organizationId)),
    [organizationId]
  );

  const secret = secrets?.[0];

  if (!secret) {
    throw new Error("secret not found");
  }

  const handleCopy = () => {
    navigator.clipboard.writeText(secret.secret).then(
      () => {
        /* clipboard successfully set */
      },
      () => {
        /* clipboard write failed */
      }
    );
  };

  const handleRotate = () => {};

  const handleRevoke = () => {};

  return (
    <SettingsLayout.Root>
      <SettingsLayout.Header>
        <SettingsLayout.HeaderTitle>Security</SettingsLayout.HeaderTitle>
        <SettingsLayout.HeaderDescription>
          Manage JWT secrets for widget SSO authentication.
        </SettingsLayout.HeaderDescription>
      </SettingsLayout.Header>
      <SettingsLayout.Content>
        <SettingsItem.Root>
          <SettingsItem.Header>
            <SettingsItem.Title>JWT Authentication</SettingsItem.Title>
            <SettingsItem.Description>
              Sign user data with your secret so Feeblo can verify who is
              submitting feedback.
            </SettingsItem.Description>
          </SettingsItem.Header>
          <SettingsItem.Content>
            <SettingsItem.Item>
              <SettingsItem.ItemContent>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Badge variant="default">Active</Badge>
                    <span className="text-muted-foreground text-sm">
                      Created {formatDate(secret.createdAt)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button onClick={handleCopy} size="sm" variant="outline">
                      Copy Secret
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button size="icon-sm" variant="outline">
                            <HugeiconsIcon icon={MoreVerticalIcon} />
                          </Button>
                        }
                      />

                      <DropdownMenuContent align="end" className="w-40">
                        <DropdownMenuItem
                          onClick={handleRevoke}
                          variant="destructive"
                        >
                          Revoke Immediately
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={handleRotate}>
                          Rotate (24h grace period)
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              </SettingsItem.ItemContent>
            </SettingsItem.Item>
          </SettingsItem.Content>
        </SettingsItem.Root>
      </SettingsLayout.Content>
    </SettingsLayout.Root>
  );
}
