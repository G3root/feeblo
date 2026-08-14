import {
  RegistryContext,
  useAtomRefresh,
  useAtomValue,
} from "@effect/atom-react";
import { BoardId, PostStatusId } from "@feeblo/id";
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
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
  DialogTrigger,
} from "@feeblo/ui/dialog";
import { Field, FieldLabel } from "@feeblo/ui/field";
import {
  Frame,
  FrameDescription,
  FrameHeader,
  FramePanel,
  FrameTitle,
} from "@feeblo/ui/frame";
import { useAppForm } from "@feeblo/ui/hooks/form";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "@feeblo/ui/select";
import { Switch } from "@feeblo/ui/switch";
import { toastManager } from "@feeblo/ui/toast";
import { Delete02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import { startTransition, useOptimistic, useState } from "react";
import { z } from "zod";
import {
  type GitHubConnection,
  type GitHubPostStatus,
  type GitHubSyncRule,
  gitHubAtomRegistry,
  gitHubBoardsAtom,
  gitHubConnectionsAtom,
  gitHubIntegrationStatusAtom,
  gitHubPostStatusesAtom,
  gitHubPublishSettingsAtom,
  gitHubRepositoriesAtom,
  gitHubSyncRulesAtom,
} from "../atoms";
import {
  createGitHubSyncRule,
  deleteGitHubSyncRule,
  disconnectGitHubConnection,
  startGitHubConnect,
  updateGitHubPublishSettings,
  updateGitHubSyncRule,
} from "../lib/github-connections";

type AsyncListState<T> = {
  readonly list: readonly T[];
  readonly isLoading: boolean;
  readonly loadFailed: boolean;
};

function useAsyncList<T>(
  result: AsyncResult.AsyncResult<readonly T[], unknown>
): AsyncListState<T> {
  return AsyncResult.match(result, {
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
  });
}

/** GitHub connection, automatic publishing, and issue-state rule settings. */
export function GitHubSettings({
  organizationId,
}: {
  readonly organizationId: string;
}) {
  return (
    <RegistryContext.Provider value={gitHubAtomRegistry}>
      <GitHubSettingsContent organizationId={organizationId} />
    </RegistryContext.Provider>
  );
}

function GitHubSettingsContent({
  organizationId,
}: {
  readonly organizationId: string;
}) {
  const [connecting, setConnecting] = useState(false);
  const statusResult = useAtomValue(gitHubIntegrationStatusAtom);
  const connectionsResult = useAtomValue(gitHubConnectionsAtom(organizationId));
  const refreshConnections = useAtomRefresh(
    gitHubConnectionsAtom(organizationId)
  );
  const configured = AsyncResult.match(statusResult, {
    onInitial: () => null as boolean | null,
    onFailure: () => false,
    onSuccess: ({ value }) => value,
  });
  const connections = useAsyncList<GitHubConnection>(connectionsResult);

  const installGitHubApp = async () => {
    setConnecting(true);
    try {
      const { authorizeUrl } = await startGitHubConnect(organizationId);
      window.location.assign(authorizeUrl.toString());
    } catch {
      setConnecting(false);
      toastManager.add({
        title: "Could not start GitHub App installation",
        type: "error",
      });
    }
  };

  if (configured === null) {
    return <LoadingCard message="Loading GitHub…" />;
  }
  if (!configured) {
    return (
      <LoadingCard message="GitHub is not configured for this deployment." />
    );
  }
  if (connections.isLoading) {
    return <LoadingCard message="Loading GitHub connection…" />;
  }
  if (connections.loadFailed) {
    return (
      <RetryCard
        message="GitHub connection could not be loaded."
        onRetry={refreshConnections}
      />
    );
  }
  if (connections.list.length === 0) {
    return (
      <Frame className="w-full">
        <FrameHeader>
          <FrameTitle>GitHub</FrameTitle>
          <FrameDescription>
            Let the Feeblo bot create GitHub issues and comments, then keep post
            status in sync.
          </FrameDescription>
        </FrameHeader>
        <FramePanel>
          <h2 className="font-semibold text-sm">Install the GitHub App</h2>
          <p className="text-muted-foreground text-sm">
            Choose the GitHub organization and repositories where the Feeblo bot
            can publish issues, add linked-feedback comments, and synchronize
            issue states.
          </p>
          <div className="mt-4">
            <Button disabled={connecting} onClick={installGitHubApp}>
              {connecting ? "Opening GitHub…" : "Install GitHub App"}
            </Button>
          </div>
        </FramePanel>
      </Frame>
    );
  }
  return (
    <div className="grid gap-4">
      {connections.list.map((connection) => (
        <GitHubConnectionFrame
          connection={connection}
          key={connection.id}
          onDisconnected={() => {
            refreshConnections();
            toastManager.add({
              title: "GitHub integration removed",
              type: "success",
            });
          }}
          organizationId={organizationId}
        />
      ))}
    </div>
  );
}

function LoadingCard({ message }: { readonly message: string }) {
  return (
    <Card>
      <CardPanel>
        <p className="text-muted-foreground text-sm">{message}</p>
      </CardPanel>
    </Card>
  );
}

function RetryCard({
  message,
  onRetry,
}: {
  readonly message: string;
  readonly onRetry: () => void;
}) {
  return (
    <Card>
      <CardPanel>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-destructive">{message}</span>
          <Button onClick={onRetry} size="sm" variant="outline">
            Try again
          </Button>
        </div>
      </CardPanel>
    </Card>
  );
}

function GitHubConnectionFrame({
  connection,
  onDisconnected,
  organizationId,
}: {
  readonly connection: GitHubConnection;
  readonly onDisconnected: () => void;
  readonly organizationId: string;
}) {
  const args = { organizationId, connectionId: connection.id };
  const [dialogOpen, setDialogOpen] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const handleDisconnect = async () => {
    setDisconnecting(true);
    try {
      await disconnectGitHubConnection(args);
      setDialogOpen(false);
      onDisconnected();
    } catch {
      setDisconnecting(false);
      setDialogOpen(false);
      toastManager.add({
        title: "Could not remove GitHub integration",
        type: "error",
      });
    }
  };

  return (
    <Frame className="w-full">
      <FrameHeader>
        <FrameTitle>{connection.login ?? "GitHub installation"}</FrameTitle>
        <FrameDescription>
          Feeblo GitHub App installed for this account.
        </FrameDescription>
      </FrameHeader>
      {connection.lifecycle === "active" ? (
        <>
          <GitHubPublishingSettings args={args} />
          <GitHubSyncRules args={args} />
        </>
      ) : (
        <FramePanel>
          <p className="text-muted-foreground text-sm">
            Finishing GitHub App installation. Refresh this page after selecting
            repositories in GitHub.
          </p>
        </FramePanel>
      )}
      <FramePanel>
        <h2 className="font-semibold text-sm">Remove integration</h2>
        <p className="text-muted-foreground text-sm">
          Stop GitHub publishing and synchronization for this Feeblo
          organization.
        </p>
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
                  Remove GitHub integration
                </Button>
              }
            />
            <AlertDialogPopup>
              <AlertDialogHeader>
                <AlertDialogTitle>Remove GitHub integration?</AlertDialogTitle>
                <AlertDialogDescription>
                  Feeblo will stop creating issues and processing issue status
                  changes for {connection.login ?? "this GitHub installation"}.
                  Existing post-to-issue links will remain. The Feeblo bot will
                  also be uninstalled from this GitHub account and lose access
                  to its selected repositories.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  className="text-destructive"
                  onClick={handleDisconnect}
                >
                  {disconnecting ? "Removing…" : "Remove integration"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogPopup>
          </AlertDialog>
        </div>
      </FramePanel>
    </Frame>
  );
}

function GitHubPublishingSettings({
  args,
}: {
  readonly args: {
    readonly organizationId: string;
    readonly connectionId: string;
  };
}) {
  const settingsResult = useAtomValue(gitHubPublishSettingsAtom(args));
  const repositoriesResult = useAtomValue(gitHubRepositoriesAtom(args));
  const boardsResult = useAtomValue(gitHubBoardsAtom(args.organizationId));
  const refreshSettings = useAtomRefresh(gitHubPublishSettingsAtom(args));
  const settings = AsyncResult.match(settingsResult, {
    onInitial: () => null,
    onFailure: ({ previousSuccess }) =>
      Option.getOrNull(previousSuccess)?.value ?? null,
    onSuccess: ({ value }) => value,
  });
  const repositories = useAsyncList(repositoriesResult);
  const boards = useAsyncList(boardsResult);
  const [optimisticSettings, setOptimisticSettings] = useOptimistic(
    settings,
    (_current, next: NonNullable<typeof settings>) => next
  );

  const save = (next: NonNullable<typeof settings>) => {
    startTransition(async () => {
      setOptimisticSettings(next);
      try {
        await updateGitHubPublishSettings({ ...args, ...next });
        refreshSettings();
      } catch {
        refreshSettings();
        toastManager.add({
          title: "Could not save GitHub publishing settings",
          type: "error",
        });
      }
    });
  };
  if (!optimisticSettings) {
    return (
      <FramePanel>
        <p className="text-muted-foreground text-sm">
          Loading issue publishing settings…
        </p>
      </FramePanel>
    );
  }
  const selectedRepository =
    optimisticSettings.repositoryOwner && optimisticSettings.repositoryName
      ? `${optimisticSettings.repositoryOwner}/${optimisticSettings.repositoryName}`
      : "";
  return (
    <FramePanel>
      <h2 className="font-semibold text-sm">Automatic issue publishing</h2>
      <p className="text-muted-foreground text-sm">
        Create a GitHub issue automatically when a new post matches this scope.
      </p>
      <div className="mt-4 grid gap-4">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm">Publish new posts automatically</span>
          <Switch
            checked={optimisticSettings.enabled}
            onCheckedChange={(enabled) =>
              save({ ...optimisticSettings, enabled })
            }
          />
        </div>
        <div className="grid gap-1.5 text-sm">
          <span>Repository</span>
          <Select
            disabled={repositories.isLoading}
            onValueChange={(value) => {
              const [repositoryOwner, repositoryName] =
                String(value).split("/");
              return save({
                ...optimisticSettings,
                repositoryOwner: repositoryOwner ?? null,
                repositoryName: repositoryName ?? null,
              });
            }}
            value={selectedRepository}
          >
            <SelectTrigger className="w-full">
              <SelectValue
                placeholder={
                  repositories.loadFailed
                    ? "Repositories could not be loaded"
                    : "Select a repository"
                }
              >
                {(value: string) =>
                  repositories.list.find(
                    (repository) => repository.fullName === value
                  )?.fullName ?? "Select a repository"
                }
              </SelectValue>
            </SelectTrigger>
            <SelectPopup>
              {repositories.list.map((repository) => (
                <SelectItem
                  key={repository.fullName}
                  value={repository.fullName}
                >
                  {repository.fullName}
                  {repository.private ? " (private)" : ""}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </div>
        <div className="grid gap-2 text-sm">
          <span>Boards</span>
          <div className="flex flex-col gap-2">
            <BoardScopeSwitch
              checked={optimisticSettings.boardScope === "any_board"}
              description="Publish posts created on every board"
              label="All boards"
              onCheckedChange={(checked) => {
                if (checked) {
                  save({
                    ...optimisticSettings,
                    boardScope: "any_board",
                    boardId: null,
                  });
                }
              }}
            />
            {boards.list.map((board) => (
              <BoardScopeSwitch
                checked={optimisticSettings.boardId === board.id}
                description="Publish posts created on this board"
                key={board.id}
                label={board.name}
                onCheckedChange={(checked) => {
                  if (checked) {
                    Option.match(
                      Schema.decodeUnknownOption(BoardId.schema)(board.id),
                      {
                        onNone: () =>
                          toastManager.add({
                            title: "The selected board is no longer available",
                            type: "error",
                          }),
                        onSome: (boardId) =>
                          save({
                            ...optimisticSettings,
                            boardScope: "specific_board",
                            boardId,
                          }),
                      }
                    );
                  }
                }}
              />
            ))}
            {boards.isLoading ? (
              <p className="text-muted-foreground text-xs">Loading boards…</p>
            ) : null}
            {boards.loadFailed ? (
              <p className="text-destructive text-xs">
                Boards could not be loaded.
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </FramePanel>
  );
}

function BoardScopeSwitch({
  checked,
  description,
  label,
  onCheckedChange,
}: {
  readonly checked: boolean;
  readonly description: string;
  readonly label: string;
  readonly onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
      <div className="min-w-0">
        <p className="truncate font-medium text-sm">{label}</p>
        <p className="text-muted-foreground text-xs">{description}</p>
      </div>
      <Switch
        aria-label={label}
        checked={checked}
        onCheckedChange={onCheckedChange}
      />
    </div>
  );
}

function GitHubSyncRules({
  args,
}: {
  readonly args: {
    readonly organizationId: string;
    readonly connectionId: string;
  };
}) {
  const rulesResult = useAtomValue(gitHubSyncRulesAtom(args));
  const statusesResult = useAtomValue(
    gitHubPostStatusesAtom(args.organizationId)
  );
  const refreshRules = useAtomRefresh(gitHubSyncRulesAtom(args));
  const rules = useAsyncList<GitHubSyncRule>(rulesResult);
  const statuses = useAsyncList<GitHubPostStatus>(statusesResult);
  let rulesContent: React.ReactNode;
  if (rules.isLoading) {
    rulesContent = (
      <p className="text-muted-foreground text-sm">Loading rules…</p>
    );
  } else if (rules.loadFailed) {
    rulesContent = (
      <p className="text-destructive text-sm">Rules could not be loaded.</p>
    );
  } else if (rules.list.length === 0) {
    rulesContent = (
      <p className="text-muted-foreground text-sm">No rules yet.</p>
    );
  } else {
    rulesContent = rules.list.map((rule) => (
      <GitHubSyncRuleRow
        args={args}
        key={rule.id}
        onChanged={refreshRules}
        rule={rule}
        statuses={statuses.list}
      />
    ));
  }
  return (
    <FramePanel>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold text-sm">Issue status rules</h2>
          <p className="text-muted-foreground text-sm">
            Set a Feeblo status when all or any linked GitHub issues are open or
            closed.
          </p>
        </div>
        <GitHubSyncRuleCreateDialog
          args={args}
          key={statuses.list[0]?.id ?? "loading"}
          onCreated={refreshRules}
          statuses={statuses.list}
          statusesLoading={statuses.isLoading}
        />
      </div>
      <div className="mt-4 grid gap-3">{rulesContent}</div>
    </FramePanel>
  );
}

const gitHubRuleFormSchema = z.object({
  issueMatchMode: z.enum(["all", "any"]),
  issueState: z.enum(["open", "closed"]),
  postStatusId: z.string().min(1, "Select a Feeblo status"),
  upvoterNotificationPolicy: z.enum([
    "notify_upvoters",
    "do_not_notify_upvoters",
  ]),
});

function GitHubSyncRuleCreateDialog({
  args,
  onCreated,
  statuses,
  statusesLoading,
}: {
  readonly args: {
    readonly organizationId: string;
    readonly connectionId: string;
  };
  readonly onCreated: () => void;
  readonly statuses: readonly GitHubPostStatus[];
  readonly statusesLoading: boolean;
}) {
  const [open, setOpen] = useState(false);
  const form = useAppForm({
    defaultValues: {
      issueMatchMode: "all" as "all" | "any",
      issueState: "closed" as "open" | "closed",
      postStatusId: statuses[0]?.id ?? "",
      upvoterNotificationPolicy: "notify_upvoters" as
        | "notify_upvoters"
        | "do_not_notify_upvoters",
    },
    validators: { onSubmit: gitHubRuleFormSchema },
    onSubmit: async ({ value }) => {
      const postStatusId = Schema.decodeUnknownOption(PostStatusId.schema)(
        value.postStatusId
      );
      if (Option.isNone(postStatusId)) {
        toastManager.add({
          title: "The selected Feeblo status is no longer available",
          type: "error",
        });
        return;
      }
      try {
        await createGitHubSyncRule({
          ...args,
          ...value,
          postStatusId: postStatusId.value,
          enabled: true,
        });
        setOpen(false);
        form.reset();
        onCreated();
        toastManager.add({
          title: "GitHub synchronization rule created",
          type: "success",
        });
      } catch {
        toastManager.add({
          title: "Could not create GitHub synchronization rule",
          type: "error",
        });
      }
    },
  });

  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <DialogTrigger
        render={
          <Button
            disabled={statusesLoading || statuses.length === 0}
            size="sm"
            variant="outline"
          />
        }
      >
        Add rule
      </DialogTrigger>
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>Add GitHub synchronization rule</DialogTitle>
          <DialogDescription>
            Choose when linked GitHub issues should update the Feeblo post.
          </DialogDescription>
        </DialogHeader>
        <form
          className="contents"
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            form.handleSubmit();
          }}
        >
          <DialogPanel className="grid gap-4">
            <form.Field name="issueMatchMode">
              {(field) => (
                <RuleFormField
                  label="When"
                  onValueChange={field.handleChange}
                  options={[
                    ["all", "All linked issues"],
                    ["any", "Any linked issue"],
                  ]}
                  value={field.state.value}
                />
              )}
            </form.Field>
            <form.Field name="issueState">
              {(field) => (
                <RuleFormField
                  label="Issue status"
                  onValueChange={field.handleChange}
                  options={[
                    ["open", "Open"],
                    ["closed", "Closed"],
                  ]}
                  value={field.state.value}
                />
              )}
            </form.Field>
            <form.Field name="postStatusId">
              {(field) => (
                <RuleFormField
                  label="Set Feeblo status"
                  onValueChange={field.handleChange}
                  options={statuses.map(
                    (status) =>
                      [status.id, status.type.replaceAll("_", " ")] as const
                  )}
                  value={field.state.value}
                />
              )}
            </form.Field>
            <form.Field name="upvoterNotificationPolicy">
              {(field) => (
                <RuleFormField
                  label="Upvoters"
                  onValueChange={field.handleChange}
                  options={[
                    ["notify_upvoters", "Notify upvoters"],
                    ["do_not_notify_upvoters", "Don't notify"],
                  ]}
                  value={field.state.value}
                />
              )}
            </form.Field>
          </DialogPanel>
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="ghost" />}>
              Cancel
            </DialogClose>
            <form.AppForm>
              <form.SubscribeButton label="Add rule" />
            </form.AppForm>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}

function RuleFormField<const Value extends string>({
  label,
  onValueChange,
  options,
  value,
}: {
  readonly label: string;
  readonly onValueChange: (value: Value) => void;
  readonly options: readonly (readonly [Value, string])[];
  readonly value: Value;
}) {
  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <Select
        onValueChange={(selectedValue) => {
          const option = options.find(
            ([optionValue]) => optionValue === selectedValue
          );
          if (option) {
            onValueChange(option[0]);
          }
        }}
        value={value}
      >
        <SelectTrigger className="w-full">
          <SelectValue>
            {(selectedValue: string) =>
              options.find(
                ([optionValue]) => optionValue === selectedValue
              )?.[1] ?? `Select ${label.toLowerCase()}`
            }
          </SelectValue>
        </SelectTrigger>
        <SelectPopup>
          {options.map(([optionValue, optionLabel]) => (
            <SelectItem key={optionValue} value={optionValue}>
              {optionLabel}
            </SelectItem>
          ))}
        </SelectPopup>
      </Select>
    </Field>
  );
}

function GitHubSyncRuleRow({
  args,
  rule,
  statuses,
  onChanged,
}: {
  readonly args: {
    readonly organizationId: string;
    readonly connectionId: string;
  };
  readonly rule: GitHubSyncRule;
  readonly statuses: readonly GitHubPostStatus[];
  readonly onChanged: () => void;
}) {
  const [optimisticRule, setOptimisticRule] = useOptimistic(
    rule,
    (_current, next: GitHubSyncRule) => next
  );
  const [deleting, setDeleting] = useState(false);
  const save = (next: GitHubSyncRule) => {
    startTransition(async () => {
      setOptimisticRule(next);
      try {
        await updateGitHubSyncRule({ ...args, ...next });
        onChanged();
      } catch {
        onChanged();
        toastManager.add({
          title: "Could not update GitHub synchronization rule",
          type: "error",
        });
      }
    });
  };
  const remove = async () => {
    setDeleting(true);
    try {
      await deleteGitHubSyncRule({
        organizationId: args.organizationId,
        connectionId: args.connectionId,
        id: rule.id,
      });
      onChanged();
      toastManager.add({
        title: "GitHub synchronization rule removed",
        type: "success",
      });
    } catch {
      toastManager.add({
        title: "Could not remove GitHub synchronization rule",
        type: "error",
      });
    } finally {
      setDeleting(false);
    }
  };
  return (
    <div className="grid gap-3 rounded-md border p-3 md:grid-cols-[1fr_1fr_1fr_1fr_auto] md:items-end">
      <RuleSelect
        disabled={deleting}
        label="When"
        onValueChange={(issueMatchMode) =>
          save({
            ...optimisticRule,
            // SAFETY: the value originates from the hardcoded options below, so it is one of the allowed literals.
            issueMatchMode: issueMatchMode as GitHubSyncRule["issueMatchMode"],
          })
        }
        options={[
          ["all", "All linked issues"],
          ["any", "Any linked issue"],
        ]}
        value={optimisticRule.issueMatchMode}
      />
      <RuleSelect
        disabled={deleting}
        label="are"
        onValueChange={(issueState) =>
          save({
            ...optimisticRule,
            // SAFETY: the value originates from the hardcoded options below, so it is one of the allowed literals.
            issueState: issueState as GitHubSyncRule["issueState"],
          })
        }
        options={[
          ["open", "Open"],
          ["closed", "Closed"],
        ]}
        value={optimisticRule.issueState}
      />
      <RuleSelect
        disabled={deleting || statuses.length === 0}
        label="Set Feeblo status"
        onValueChange={(postStatusId) => {
          Option.match(
            Schema.decodeUnknownOption(PostStatusId.schema)(
              String(postStatusId)
            ),
            {
              onNone: () =>
                toastManager.add({
                  title: "The selected Feeblo status is no longer available",
                  type: "error",
                }),
              onSome: (decodedPostStatusId) =>
                save({ ...optimisticRule, postStatusId: decodedPostStatusId }),
            }
          );
        }}
        options={statuses.map(
          (status) => [status.id, status.type.replaceAll("_", " ")] as const
        )}
        value={optimisticRule.postStatusId}
      />
      <RuleSelect
        disabled={deleting}
        label="Upvoters"
        onValueChange={(upvoterNotificationPolicy) =>
          save({
            ...optimisticRule,
            // SAFETY: the value originates from the hardcoded options below, so it is one of the allowed literals.
            upvoterNotificationPolicy:
              upvoterNotificationPolicy as GitHubSyncRule["upvoterNotificationPolicy"],
          })
        }
        options={[
          ["notify_upvoters", "Notify upvoters"],
          ["do_not_notify_upvoters", "Don't notify"],
        ]}
        value={optimisticRule.upvoterNotificationPolicy}
      />
      <div className="flex items-center gap-2">
        <Switch
          aria-label="Enable GitHub synchronization rule"
          checked={optimisticRule.enabled}
          disabled={deleting}
          onCheckedChange={(enabled) => save({ ...optimisticRule, enabled })}
        />
        <Button
          aria-label="Delete GitHub synchronization rule"
          disabled={deleting}
          onClick={remove}
          size="icon-sm"
          variant="ghost"
        >
          <HugeiconsIcon icon={Delete02Icon} />
        </Button>
      </div>
    </div>
  );
}

function RuleSelect({
  label,
  value,
  options,
  disabled,
  onValueChange,
}: {
  readonly label: string;
  readonly value: string;
  readonly options: readonly (readonly [string, string])[];
  readonly disabled: boolean;
  readonly onValueChange: (value: string) => void;
}) {
  return (
    <div className="grid gap-1 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <Select
        disabled={disabled}
        onValueChange={(value) => onValueChange(String(value))}
        value={value}
      >
        <SelectTrigger className="w-full">
          <SelectValue>
            {(selectedValue: string) =>
              options.find(
                ([optionValue]) => optionValue === selectedValue
              )?.[1] ?? `Select ${label.toLowerCase()}`
            }
          </SelectValue>
        </SelectTrigger>
        <SelectPopup>
          {options.map(([optionValue, optionLabel]) => (
            <SelectItem key={optionValue} value={optionValue}>
              {optionLabel}
            </SelectItem>
          ))}
        </SelectPopup>
      </Select>
    </div>
  );
}
