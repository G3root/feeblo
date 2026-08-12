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
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "@feeblo/ui/select";
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
  const { connections, isLoading, loadFailed } = useMemo(
    () =>
      AsyncResult.match(connectionsResult, {
        onInitial: () => ({
          connections: [] as SlackConnection[],
          isLoading: true,
          loadFailed: false,
        }),
        onFailure: ({ previousSuccess }) =>
          Option.match(previousSuccess, {
            onNone: () => ({
              connections: [],
              isLoading: false,
              loadFailed: true,
            }),
            onSome: ({ value }) => ({
              connections: value,
              isLoading: false,
              loadFailed: false,
            }),
          }),
        onSuccess: ({ value }) => ({
          connections: value,
          isLoading: false,
          loadFailed: false,
        }),
      }),
    [connectionsResult]
  );

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
          <h2 className="font-semibold text-sm">Feedback channel</h2>
          <p className="text-muted-foreground text-sm">
            New requests are posted to this channel. Add the Feeblo bot to a
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
  const { channels, isLoading, loadFailed } = useMemo(
    () =>
      AsyncResult.match(channelsResult, {
        onInitial: () => ({
          channels: [] as SlackChannel[],
          isLoading: true,
          loadFailed: false,
        }),
        onFailure: ({ previousSuccess }) =>
          Option.match(previousSuccess, {
            onNone: () => ({
              channels: [],
              isLoading: false,
              loadFailed: true,
            }),
            onSome: ({ value }) => ({
              channels: value,
              isLoading: false,
              loadFailed: false,
            }),
          }),
        onSuccess: ({ value }) => ({
          channels: value,
          isLoading: false,
          loadFailed: false,
        }),
      }),
    [channelsResult]
  );

  const enabledChannel = channels.find(
    (channel) => channel.notificationsEnabled
  );

  const handleChange = async (channelId: string) => {
    if (enabledChannel?.id === channelId) {
      return;
    }
    try {
      // The feedback channel is exclusive: enabling a new one disables the
      // previously selected channel so notifications go to exactly one place.
      if (enabledChannel !== undefined) {
        await updateChannelNotifications({
          channelId: enabledChannel.id,
          channelName: enabledChannel.name,
          connectionId,
          enabled: false,
          organizationId,
        });
      }
      await updateChannelNotifications({
        channelId,
        channelName:
          channels.find((channel) => channel.id === channelId)?.name ??
          channelId,
        connectionId,
        enabled: true,
        organizationId,
      });
      refreshChannels();
      toastManager.add({
        title: "Feedback channel updated",
        type: "success",
      });
    } catch {
      toastManager.add({
        title: "Could not update the feedback channel",
        type: "error",
      });
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

  const handleToggleOff = async () => {
    if (enabledChannel === undefined) {
      return;
    }
    try {
      await updateChannelNotifications({
        channelId: enabledChannel.id,
        channelName: enabledChannel.name,
        connectionId,
        enabled: false,
        organizationId,
      });
      refreshChannels();
      toastManager.add({
        title: "New post notifications disabled",
        type: "success",
      });
    } catch {
      toastManager.add({
        title: "Could not disable notifications",
        type: "error",
      });
    }
  };

  return (
    <>
      <Select
        onValueChange={(value) => {
          if (value !== null) {
            if (value === "") {
              handleToggleOff();
            } else {
              handleChange(value);
            }
          }
        }}
        value={enabledChannel?.id ?? ""}
      >
        <SelectTrigger className="w-full sm:max-w-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectPopup>
          <SelectItem value="">Notifications off</SelectItem>
          {channels.map((channel) => (
            <SelectItem key={channel.id} value={channel.id}>
              #{channel.name}
            </SelectItem>
          ))}
        </SelectPopup>
      </Select>
      {enabledChannel !== undefined && !enabledChannel.isMember ? (
        <p className="mt-2 text-muted-foreground text-xs">
          {enabledChannel.isPrivate
            ? `#${enabledChannel.name} is private — add the bot once from Slack to enable notifications.`
            : `The bot will join #${enabledChannel.name} automatically on the first post.`}
        </p>
      ) : null}
    </>
  );
}
