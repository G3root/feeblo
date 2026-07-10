/** biome-ignore-all lint/style/noNonNullAssertion: <explanation> */
import { Badge } from "@feeblo/ui/badge";
import { Button } from "@feeblo/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@feeblo/ui/dropdown-menu";
import { toastManager } from "@feeblo/ui/toast";
import { MoreVerticalIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { eq, useLiveQuery } from "@tanstack/react-db";
import { createFileRoute } from "@tanstack/react-router";
import { SettingsItem } from "~/features/settings/components/settings-item";
import { SettingsLayout } from "~/features/settings/components/settings-layout";
import { useOrganizationId } from "~/hooks/use-organization-id";
import { jwtSecretCollection } from "~/lib/collections";
import { fetchRpc } from "~/lib/runtime";

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

  const now = new Date();

  const activeSecrets = (secrets ?? []).filter((s) => s.revokedAt === null);
  const gracePeriodSecrets = (secrets ?? []).filter(
    (s) => s.revokedAt !== null && s.revokedAt > now
  );

  const activeSecret = activeSecrets[0];
  const lastRevokedAt = (secrets ?? []).reduce<Date | null>((latest, s) => {
    if (s.revokedAt && (!latest || s.revokedAt > latest)) {
      return s.revokedAt;
    }
    return latest;
  }, null);

  if (!activeSecret) {
    throw new Error("secret not found");
  }

  const handleCopy = () => {
    navigator.clipboard.writeText(activeSecret.secret).then(
      () => {
        toastManager.add({
          title: "Secret copied to clipboard",
          type: "success",
        });
      },
      () => {
        toastManager.add({ title: "Failed to copy secret", type: "error" });
      }
    );
  };

  const handleRotate = async () => {
    try {
      await fetchRpc((rpc) => rpc.JwtSecretRotate({ organizationId }));
      toastManager.add({
        title: "Secret rotated successfully",
        type: "success",
      });
    } catch {
      toastManager.add({ title: "Failed to rotate secret", type: "error" });
      return;
    }
    await jwtSecretCollection.utils.refetch();
  };

  const handleRevoke = async () => {
    try {
      await fetchRpc((rpc) =>
        rpc.JwtSecretRevoke({ organizationId, secretId: activeSecret.id })
      );
      toastManager.add({
        title: "Secret revoked immediately",
        type: "success",
      });
    } catch {
      toastManager.add({ title: "Failed to revoke secret", type: "error" });
      return;
    }
    await jwtSecretCollection.utils.refetch();
  };

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
                      Created {formatDate(activeSecret.createdAt)}
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

            {gracePeriodSecrets.map((s) => (
              <SettingsItem.Item key={s.id}>
                <SettingsItem.ItemContent>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Badge variant="secondary">Grace period</Badge>
                      <span className="text-muted-foreground text-sm">
                        Expires {formatDate(s.revokedAt!)}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        onClick={() => {
                          navigator.clipboard.writeText(s.secret).then(
                            () =>
                              toastManager.add({
                                title: "Secret copied to clipboard",
                                type: "success",
                              }),
                            () =>
                              toastManager.add({
                                title: "Failed to copy secret",
                                type: "error",
                              })
                          );
                        }}
                        size="sm"
                        variant="outline"
                      >
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
                            onClick={async () => {
                              try {
                                await fetchRpc((rpc) =>
                                  rpc.JwtSecretRevoke({
                                    organizationId,
                                    secretId: s.id,
                                  })
                                );
                                toastManager.add({
                                  title: "Secret revoked immediately",
                                  type: "success",
                                });
                              } catch {
                                toastManager.add({
                                  title: "Failed to revoke secret",
                                  type: "error",
                                });
                                return;
                              }
                              await jwtSecretCollection.utils.refetch();
                            }}
                            variant="destructive"
                          >
                            Revoke Immediately
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                </SettingsItem.ItemContent>
              </SettingsItem.Item>
            ))}

            {lastRevokedAt && (
              <p className="text-muted-foreground text-sm">
                Last revoked: {formatDate(lastRevokedAt)}
              </p>
            )}
          </SettingsItem.Content>
        </SettingsItem.Root>
      </SettingsLayout.Content>
    </SettingsLayout.Root>
  );
}
