import { RegistryContext } from "@effect/atom-react";
import { toastManager } from "@feeblo/ui/toast";
import { hasPermission, usePolicy } from "@feeblo/web-shared/use-policy";
import { DiscordIcon, GithubIcon, SlackIcon } from "@hugeicons/core-free-icons";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect } from "react";
import { z } from "zod";

import {
  type DiscordConnection,
  discordAtomRegistry,
  connectionsAtom as discordConnectionsAtom,
  discordStatusAtom,
} from "~/features/discord/atoms";
import { startDiscordConnect } from "~/features/discord/lib/connections";
import {
  type GitHubConnection,
  gitHubAtomRegistry,
  gitHubConnectionsAtom,
  gitHubIntegrationStatusAtom,
} from "~/features/github/atoms";
import { startGitHubConnect } from "~/features/github/lib/github-connections";
import {
  IntegrationCard,
  type IntegrationCardConfig,
} from "~/features/integrations/components/integration-card";
import { SettingsAccessDenied } from "~/features/settings/components/settings-access-denied";
import { SettingsLayout } from "~/features/settings/components/settings-layout";
import {
  connectionsAtom,
  type SlackConnection,
  slackAtomRegistry,
  slackStatusAtom,
} from "~/features/slack/atoms";
import { startSlackConnect } from "~/features/slack/lib/connections";
import { useOrganizationId } from "~/hooks/use-organization-id";

const slackConfig: IntegrationCardConfig<SlackConnection> = {
  name: "Slack",
  icon: SlackIcon,
  description:
    "Let your team send feedback with /feeblo, forward messages with “Send to Feeblo”, and get new requests posted to your channels.",
  statusAtom: slackStatusAtom,
  connectionsAtom,
  startConnect: startSlackConnect,
  connectErrorMessage: "Could not start Slack connection",
  connectLabel: (connecting) => (connecting ? "Redirecting…" : "Connect"),
  configureTo: "/$organizationId/settings/integrations/slack",
  connectionDetail: (connections) =>
    connections.map((connection) => connection.teamName).join(", "),
};

const discordConfig: IntegrationCardConfig<DiscordConnection> = {
  name: "Discord",
  icon: DiscordIcon,
  description:
    "Let your team send feedback with /feeblo, forward messages with “Send to Feeblo”, and get new requests posted to your channels.",
  statusAtom: discordStatusAtom,
  connectionsAtom: discordConnectionsAtom,
  startConnect: startDiscordConnect,
  connectErrorMessage: "Could not start Discord connection",
  connectLabel: (connecting) => (connecting ? "Redirecting…" : "Connect"),
  configureTo: "/$organizationId/settings/integrations/discord",
  connectionDetail: (connections) =>
    connections.map((connection) => connection.guildName).join(", "),
};

const gitHubConfig: IntegrationCardConfig<GitHubConnection> = {
  name: "GitHub",
  icon: GithubIcon,
  description:
    "Choose repositories for the Feeblo bot to publish feedback as GitHub issues and comments.",
  statusAtom: gitHubIntegrationStatusAtom,
  connectionsAtom: gitHubConnectionsAtom,
  startConnect: startGitHubConnect,
  connectErrorMessage: "Could not start GitHub App installation",
  connectLabel: (connecting) =>
    connecting ? "Opening GitHub…" : "Install GitHub App",
  configureTo: "/$organizationId/settings/integrations/github",
};

export const Route = createFileRoute("/$organizationId/settings/integrations/")(
  {
    validateSearch: (search) =>
      z
        .object({
          discord: z.enum(["connected", "error"]).optional(),
          github: z.enum(["connected", "error"]).optional(),
          slack: z.enum(["connected", "error"]).optional(),
          message: z.string().min(1).optional(),
        })
        .parse(search),
    component: IntegrationsSettingsRoute,
  }
);

function IntegrationsSettingsRoute() {
  const organizationId = useOrganizationId();
  const { allowed, isPending } = usePolicy(
    hasPermission(organizationId, "integrations.manage")
  );
  const search = Route.useSearch();
  const router = useRouter();

  // Surface the result of provider connection flows the server redirected back
  // with, then strip the query params so the notice shows only once.
  useEffect(() => {
    if (search.slack !== undefined) {
      if (search.slack === "connected") {
        toastManager.add({ title: "Slack connected", type: "success" });
      } else {
        toastManager.add({
          title: search.message ?? "Could not connect Slack",
          type: "error",
        });
      }
    } else if (search.discord !== undefined) {
      if (search.discord === "connected") {
        toastManager.add({ title: "Discord connected", type: "success" });
      } else {
        toastManager.add({
          title: search.message ?? "Could not connect Discord",
          type: "error",
        });
      }
    } else if (search.github !== undefined) {
      if (search.github === "connected") {
        toastManager.add({
          title: "GitHub App installed",
          description: "Feeblo can now create issues and comments as its bot.",
          type: "success",
        });
      } else {
        toastManager.add({
          title: search.message ?? "Could not connect GitHub",
          type: "error",
        });
      }
    } else {
      return;
    }
    router.navigate({
      to: "/$organizationId/settings/integrations",
      params: { organizationId },
      search: {},
      replace: true,
    });
  }, [
    organizationId,
    router,
    search.discord,
    search.github,
    search.message,
    search.slack,
  ]);

  if (isPending) {
    return null;
  }
  if (!allowed) {
    return <SettingsAccessDenied />;
  }

  return (
    <SettingsLayout.Root size="large">
      <SettingsLayout.Header>
        <SettingsLayout.HeaderTitle>Integrations</SettingsLayout.HeaderTitle>
        <SettingsLayout.HeaderDescription>
          Connect the tools your team uses every day to Feeblo.
        </SettingsLayout.HeaderDescription>
      </SettingsLayout.Header>
      <SettingsLayout.Content>
        <div className="grid gap-4">
          <RegistryContext.Provider value={slackAtomRegistry}>
            <IntegrationCard
              config={slackConfig}
              organizationId={organizationId}
            />
          </RegistryContext.Provider>
          <RegistryContext.Provider value={discordAtomRegistry}>
            <IntegrationCard
              config={discordConfig}
              organizationId={organizationId}
            />
          </RegistryContext.Provider>
          <RegistryContext.Provider value={gitHubAtomRegistry}>
            <IntegrationCard
              config={gitHubConfig}
              organizationId={organizationId}
            />
          </RegistryContext.Provider>
        </div>
      </SettingsLayout.Content>
    </SettingsLayout.Root>
  );
}
