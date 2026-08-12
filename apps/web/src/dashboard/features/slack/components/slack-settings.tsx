import {
  RegistryContext,
  useAtomRefresh,
  useAtomValue,
} from "@effect/atom-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@feeblo/ui/alert-dialog";
import { Button } from "@feeblo/ui/button";
import { Card, CardPanel } from "@feeblo/ui/card";
import {
  Frame,
  FrameDescription,
  FrameHeader,
  FramePanel,
  FrameTitle,
} from "@feeblo/ui/frame";
import { Switch } from "@feeblo/ui/switch";
import { toastManager } from "@feeblo/ui/toast";
import * as Option from "effect/Option";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import { useMemo, useState } from "react";
import {
  channelsAtom,
  connectionsAtom,
  type SlackChannel,
  type SlackConnection,
  slackAtomRegistry,
} from "../atoms";
import {
  disconnectSlackConnection,
  startSlackConnect,
  updateChannelNotifications,
} from "../lib/connections";

type AsyncListState<T> = {
  readonly list: readonly T[];
  readonly isLoading: boolean;
  readonly loadFailed: boolean;
};

/** Collapses an atom AsyncResult into the loading/loaded/error trio the settings frames render. */
function useAsyncList<T>(
  result: AsyncResult.AsyncResult<readonly T[], unknown>
): AsyncListState<T> {
  return useMemo(
    () =>
      AsyncResult.match(result, {
        onInitial: () => ({ list: [], isLoading: true, loadFailed: false }),
        onFailure: ({ previousSuccess }) =>
          Option.match(previousSuccess, {
            onNone: () => ({ list: [], isLoading: false, loadFailed: true }),
            onSome: ({ value }) => ({
              list: value,
              isLoading: false,
              loadFailed: false,
            }),
          }),
        onSuccess: ({ value }) => ({
          list: value,
          isLoading: false,
          loadFailed: false,
        }),
      }),
    [result]
  );
}

export function SlackSettings({
  organizationId,
}: {
  readonly organizationId: string;
}) {
  return (
    <RegistryContext.Provider value={slackAtomRegistry}>
      <SlackSettingsContent organizationId={organizationId} />
    </RegistryContext.Provider>
  );
}

function SlackSettingsContent({
  organizationId,
}: {
  readonly organizationId: string;
}) {
  const [connecting, setConnecting] = useState(false);
  const connectionsResult = useAtomValue(connectionsAtom(organizationId));
  const refreshConnections = useAtomRefresh(connectionsAtom(organizationId));
  const {
    list: connections,
    isLoading,
    loadFailed,
  } = useAsyncList<SlackConnection>(connectionsResult);

  const handleConnect = async () => {
    setConnecting(true);
    try {
      const { authorizeUrl } = await startSlackConnect(organizationId);
      window.location.assign(authorizeUrl.toString());
    } catch {
      setConnecting(false);
      toastManager.add({
        title: "Could not start Slack connection",
        type: "error",
      });
    }
  };

  const handleDisconnected = () => {
    refreshConnections();
    toastManager.add({
      title: "Slack workspace disconnected",
      type: "success",
    });
  };

  if (isLoading) {
    return (
      <Card>
        <CardPanel>
          <p className="text-muted-foreground text-sm">
            Loading Slack connection…
          </p>
        </CardPanel>
      </Card>
    );
  }

  if (loadFailed) {
    return (
      <Card>
        <CardPanel>
          <div className="text-sm">
            Slack connection could not be loaded.{" "}
            <Button onClick={refreshConnections} size="sm" variant="outline">
              Try again
            </Button>
          </div>
        </CardPanel>
      </Card>
    );
  }

  if (connections.length === 0) {
    return (
      <Frame className="w-full">
        <FrameHeader>
          <FrameTitle>Slack</FrameTitle>
          <FrameDescription>
            Collect feedback from Slack and post new requests to your channels.
          </FrameDescription>
        </FrameHeader>
        <FramePanel>
          <h2 className="font-semibold text-sm">Connect your workspace</h2>
          <p className="text-muted-foreground text-sm">
            Let your team send feedback with /feeblo, forward messages with
            “Send to Feeblo”, and post new requests to your channels.
          </p>
          <div className="mt-4">
            <Button disabled={connecting} onClick={handleConnect}>
              {connecting ? "Redirecting to Slack…" : "Connect to Slack"}
            </Button>
          </div>
        </FramePanel>
      </Frame>
    );
  }

  return (
    <div className="grid gap-4">
      {connections.map((connection) => (
        <SlackConnectionFrame
          connection={connection}
          key={connection.id}
          onDisconnected={handleDisconnected}
          organizationId={organizationId}
        />
      ))}
    </div>
  );
}

function SlackConnectionFrame({
  connection,
  organizationId,
  onDisconnected,
}: {
  readonly connection: SlackConnection;
  readonly organizationId: string;
  readonly onDisconnected: () => void;
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const handleDisconnect = async () => {
    setDisconnecting(true);
    try {
      await disconnectSlackConnection({
        connectionId: connection.id,
        organizationId,
      });
      setDialogOpen(false);
      onDisconnected();
    } catch {
      setDisconnecting(false);
      setDialogOpen(false);
      toastManager.add({
        title: "Could not disconnect Slack",
        type: "error",
      });
    }
  };

  return (
    <Frame className="w-full">
      <FrameHeader>
        <FrameTitle>{connection.teamName}</FrameTitle>
        <FrameDescription>
          Slack workspace connected to Feeblo.
        </FrameDescription>
      </FrameHeader>
      <FramePanel>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-semibold text-sm">Workspace</h2>
            <p className="text-muted-foreground text-sm">
              {connection.teamId ?? "Connecting…"}
            </p>
          </div>
          <ConnectionBadge lifecycle={connection.lifecycle} />
        </div>
        <div className="mt-4">
          <AlertDialog
            onOpenChange={(open) => {
              if (!disconnecting) {
                setDialogOpen(open);
              }
            }}
            open={dialogOpen}
          >
            <AlertDialogTrigger
              render={
                <Button className="text-destructive" variant="outline">
                  Disconnect
                </Button>
              }
            />
            <AlertDialogPopup>
              <AlertDialogHeader>
                <AlertDialogTitle>Disconnect Slack?</AlertDialogTitle>
                <AlertDialogDescription>
                  Feeblo will lose access to {connection.teamName}. New post
                  notifications to your channels will stop, and your team won't
                  be able to send feedback with /feeblo until you reconnect.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  className="text-destructive"
                  onClick={handleDisconnect}
                >
                  {disconnecting ? "Disconnecting…" : "Disconnect"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogPopup>
          </AlertDialog>
        </div>
      </FramePanel>
      {connection.lifecycle === "active" ? (
        <FramePanel>
          <h2 className="font-semibold text-sm">New post notifications</h2>
          <p className="text-muted-foreground text-sm">
            Post new requests to one or more channels. Add the Feeblo bot to a
            channel to make it selectable.
          </p>
          <div className="mt-4">
            <FeedbackChannelSelect
              connectionId={connection.id}
              organizationId={organizationId}
            />
          </div>
        </FramePanel>
      ) : null}
    </Frame>
  );
}

function ConnectionBadge({
  lifecycle,
}: {
  readonly lifecycle: SlackConnection["lifecycle"];
}) {
  if (lifecycle === "active") {
    return (
      <span className="rounded-full bg-success/10 px-2 py-0.5 font-medium text-success text-xs">
        Connected
      </span>
    );
  }
  if (lifecycle === "connecting") {
    return (
      <span className="rounded-full bg-muted px-2 py-0.5 font-medium text-muted-foreground text-xs">
        Awaiting Slack approval
      </span>
    );
  }
  return (
    <span className="rounded-full bg-muted px-2 py-0.5 font-medium text-muted-foreground text-xs">
      {lifecycle}
    </span>
  );
}

function FeedbackChannelSelect({
  connectionId,
  organizationId,
}: {
  readonly connectionId: string;
  readonly organizationId: string;
}) {
  const args = { connectionId, organizationId };
  const channelsResult = useAtomValue(channelsAtom(args));
  const refreshChannels = useAtomRefresh(channelsAtom(args));
  const {
    list: channels,
    isLoading,
    loadFailed,
  } = useAsyncList<SlackChannel>(channelsResult);
  const [pendingChannelId, setPendingChannelId] = useState<string | null>(null);

  const handleToggle = async (channel: SlackChannel, enabled: boolean) => {
    setPendingChannelId(channel.id);
    try {
      await updateChannelNotifications({
        channelId: channel.id,
        channelName: channel.name,
        connectionId,
        enabled,
        organizationId,
      });
      refreshChannels();
      toastManager.add({
        title: enabled
          ? "New post notifications enabled"
          : "New post notifications disabled",
        type: "success",
      });
    } catch {
      refreshChannels();
      toastManager.add({
        title: "Could not update new post notifications",
        type: "error",
      });
    } finally {
      setPendingChannelId(null);
    }
  };

  if (isLoading) {
    return <p className="text-muted-foreground text-sm">Loading channels…</p>;
  }
  if (loadFailed) {
    return (
      <div className="flex items-center gap-2 text-sm">
        <span className="text-destructive">Channels could not be loaded.</span>
        <Button onClick={refreshChannels} size="sm" variant="outline">
          Retry
        </Button>
      </div>
    );
  }
  if (channels.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        No channels are visible to the bot yet. Make sure it has been added to
        the workspace, then refresh.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {channels.map((channel) => {
        const pending = pendingChannelId === channel.id;
        return (
          <div
            className="flex items-center justify-between gap-3 rounded-md border px-3 py-2"
            key={channel.id}
          >
            <div className="min-w-0">
              <p className="truncate font-medium text-sm">#{channel.name}</p>
              {channel.notificationsEnabled && !channel.isMember ? (
                <p className="mt-0.5 text-muted-foreground text-xs">
                  {channel.isPrivate
                    ? `#${channel.name} is private — add the bot once from Slack to enable notifications.`
                    : `The bot will join #${channel.name} automatically on the first post.`}
                </p>
              ) : null}
            </div>
            <Switch
              checked={channel.notificationsEnabled}
              disabled={pending}
              onCheckedChange={(checked) => handleToggle(channel, checked)}
            />
          </div>
        );
      })}
    </div>
  );
}
