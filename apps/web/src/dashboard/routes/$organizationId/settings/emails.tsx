/** biome-ignore-all lint/style/noNonNullAssertion: <explanation> */
import { Badge } from "@feeblo/ui/badge";
import { Button } from "@feeblo/ui/button";
import { toastManager } from "@feeblo/ui/toast";
import { getAuthSession } from "@feeblo/web-shared/auth-session";
import { hasPermission, usePolicy } from "@feeblo/web-shared/use-policy";
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { SettingsAccessDenied } from "~/features/settings/components/settings-access-denied";
import { SettingsItem } from "~/features/settings/components/settings-item";
import { SettingsLayout } from "~/features/settings/components/settings-layout";
import { useOrganizationId } from "~/hooks/use-organization-id";
import { fetchRpc } from "~/lib/runtime";

export const Route = createFileRoute("/$organizationId/settings/emails")({
  component: RouteComponent,
  beforeLoad: async ({ params }) => {
    const session = await getAuthSession();
    if (
      session !== null &&
      hasPermission(params.organizationId, "workspace.update")(session)
    ) {
      return null;
    }
    return null;
  },
});

type SuppressedEmail = {
  email: string;
  reason: "hard_bounce" | "complaint" | "manual";
  createdAt: Date;
};

type DeadLetter = {
  id: string;
  kind: string;
  attempts: number;
  lastError: string | null;
  createdAt: Date;
  availableAt: Date;
};

type DeliveryStats = {
  byStatus: Record<"sent" | "failed" | "skipped" | "suppressed", number>;
  byTemplate: Record<string, number>;
};

function RouteComponent() {
  const organizationId = useOrganizationId();
  const { allowed: canManageEmails, isPending: isPolicyPending } = usePolicy(
    hasPermission(organizationId, "workspace.update")
  );

  if (isPolicyPending) {
    return null;
  }
  if (!canManageEmails) {
    return <SettingsAccessDenied />;
  }

  return <EmailsSettingsContent organizationId={organizationId} />;
}

function EmailsSettingsContent({ organizationId }: { organizationId: string }) {
  const [stats, setStats] = useState<DeliveryStats | null>(null);
  const [suppressed, setSuppressed] = useState<SuppressedEmail[]>([]);
  const [deadLetters, setDeadLetters] = useState<DeadLetter[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    const [statsResult, suppressedResult, deadLetterResult] = await Promise.all(
      [
        fetchRpc((rpc) => rpc.EmailDeliveryStats({ organizationId })),
        fetchRpc((rpc) => rpc.EmailSuppressedList({ organizationId })),
        fetchRpc((rpc) => rpc.EmailDeadLetterList({ organizationId })),
      ]
    );
    setStats(statsResult);
    setSuppressed(suppressedResult as unknown as SuppressedEmail[]);
    setDeadLetters(deadLetterResult as unknown as DeadLetter[]);
    setIsLoading(false);
  }, [organizationId]);

  useEffect(() => {
    setIsLoading(true);
    load().catch(() => setIsLoading(false));
  }, [load]);

  const handleUnsuppress = async (email: string) => {
    try {
      await fetchRpc((rpc) =>
        rpc.EmailSuppressedDelete({ email, organizationId })
      );
      toastManager.add({ title: "Address un-suppressed", type: "success" });
      await load();
    } catch {
      toastManager.add({ title: "Failed to un-suppress", type: "error" });
    }
  };

  const totalDeliveries = stats
    ? Object.values(stats.byStatus).reduce((sum, value) => sum + value, 0)
    : 0;

  return (
    <SettingsLayout.Root>
      <SettingsLayout.Header>
        <SettingsLayout.HeaderTitle>Emails</SettingsLayout.HeaderTitle>
        <SettingsLayout.HeaderDescription>
          Delivery statistics, suppressed addresses, and failed notifications.
        </SettingsLayout.HeaderDescription>
      </SettingsLayout.Header>
      <SettingsLayout.Content>
        <SettingsItem.Root>
          <SettingsItem.Header>
            <SettingsItem.Title>Delivery overview</SettingsItem.Title>
            <SettingsItem.Description>
              Per-recipient delivery records for this workspace.
            </SettingsItem.Description>
          </SettingsItem.Header>
          <SettingsItem.Content>
            {isLoading ? (
              <SettingsItem.Item>
                <SettingsItem.ItemContent>
                  <p className="text-muted-foreground text-sm">Loading…</p>
                </SettingsItem.ItemContent>
              </SettingsItem.Item>
            ) : (
              <SettingsItem.Item>
                <SettingsItem.ItemContent>
                  <div className="flex flex-wrap gap-4">
                    <Badge variant="default">{totalDeliveries} total</Badge>
                    <Badge variant="outline">
                      {stats?.byStatus.sent ?? 0} sent
                    </Badge>
                    <Badge variant="outline">
                      {stats?.byStatus.failed ?? 0} failed
                    </Badge>
                    <Badge variant="outline">
                      {stats?.byStatus.suppressed ?? 0} suppressed
                    </Badge>
                    <Badge variant="outline">
                      {stats?.byStatus.skipped ?? 0} skipped
                    </Badge>
                  </div>
                  {Object.entries(stats?.byTemplate ?? {}).length > 0 && (
                    <div className="mt-4 flex flex-wrap gap-3 text-muted-foreground text-sm">
                      {Object.entries(stats!.byTemplate).map(
                        ([template, count]) => (
                          <span key={template}>
                            {template}: {count}
                          </span>
                        )
                      )}
                    </div>
                  )}
                </SettingsItem.ItemContent>
              </SettingsItem.Item>
            )}
          </SettingsItem.Content>
        </SettingsItem.Root>

        <SettingsItem.Root>
          <SettingsItem.Header>
            <SettingsItem.Title>Suppressed addresses</SettingsItem.Title>
            <SettingsItem.Description>
              Emails that will never receive notifications (hard bounces,
              complaints, or manual suppression).
            </SettingsItem.Description>
          </SettingsItem.Header>
          <SettingsItem.Content>
            {suppressed.length === 0 ? (
              <SettingsItem.Item>
                <SettingsItem.ItemContent>
                  <p className="text-muted-foreground text-sm">
                    No suppressed addresses.
                  </p>
                </SettingsItem.ItemContent>
              </SettingsItem.Item>
            ) : (
              suppressed.map((entry) => (
                <SettingsItem.Item key={entry.email}>
                  <SettingsItem.ItemContent>
                    <div className="flex items-center justify-between gap-4">
                      <div className="min-w-0">
                        <p className="truncate text-sm">{entry.email}</p>
                        <p className="text-muted-foreground text-xs">
                          {entry.reason} ·{" "}
                          {new Date(entry.createdAt).toLocaleDateString(
                            "en-US",
                            {
                              month: "short",
                              day: "numeric",
                              year: "numeric",
                            }
                          )}
                        </p>
                      </div>
                      <Button
                        onClick={() => handleUnsuppress(entry.email)}
                        size="sm"
                        variant="outline"
                      >
                        Un-suppress
                      </Button>
                    </div>
                  </SettingsItem.ItemContent>
                </SettingsItem.Item>
              ))
            )}
          </SettingsItem.Content>
        </SettingsItem.Root>

        <SettingsItem.Root>
          <SettingsItem.Header>
            <SettingsItem.Title>Failed notifications</SettingsItem.Title>
            <SettingsItem.Description>
              Email events that exhausted their delivery attempts.
            </SettingsItem.Description>
          </SettingsItem.Header>
          <SettingsItem.Content>
            {deadLetters.length === 0 ? (
              <SettingsItem.Item>
                <SettingsItem.ItemContent>
                  <p className="text-muted-foreground text-sm">
                    No failed notifications.
                  </p>
                </SettingsItem.ItemContent>
              </SettingsItem.Item>
            ) : (
              deadLetters.map((entry) => (
                <SettingsItem.Item key={entry.id}>
                  <SettingsItem.ItemContent>
                    <div className="min-w-0">
                      <p className="truncate text-sm">
                        {entry.kind} · {entry.attempts} attempts
                      </p>
                      <p className="truncate text-muted-foreground text-xs">
                        {entry.lastError ?? "Unknown error"}
                      </p>
                    </div>
                  </SettingsItem.ItemContent>
                </SettingsItem.Item>
              ))
            )}
          </SettingsItem.Content>
        </SettingsItem.Root>
      </SettingsLayout.Content>
    </SettingsLayout.Root>
  );
}
