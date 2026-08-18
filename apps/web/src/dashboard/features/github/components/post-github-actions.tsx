import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { Button } from "@feeblo/ui/button";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "@feeblo/ui/dialog";
import { useAppForm } from "@feeblo/ui/hooks/form";
import { MenuItem } from "@feeblo/ui/menu";
import { toastManager } from "@feeblo/ui/toast";
import {
  GithubIcon,
  Link01Icon,
  PlusSignIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useSelector } from "@tanstack/react-store";
import * as Option from "effect/Option";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import { useState } from "react";

import { usePostExternalResourceRefresh } from "~/features/integrations/components/post-external-resources";

import {
  type GitHubConnection,
  type GitHubRepository,
  gitHubAtomRegistry,
  gitHubConnectionsAtom,
  gitHubRepositoriesAtom,
} from "../atoms";
import {
  createGitHubPostIssue,
  linkGitHubPostIssue,
} from "../lib/github-connections";
import {
  type GitHubPostIssueAction,
  githubPostIssueFormOpts,
} from "../shared-form";
import {
  GitHubConnectionField,
  GitHubRepositoryField,
} from "./github-post-issue-fields";

type GitHubPostAction = "create" | "link" | null;

/** GitHub-owned issue actions contributed to the generic linked-resource menu. */
export function GitHubPostResourceActions({
  organizationId,
  postId,
}: {
  readonly organizationId: string;
  readonly postId: string;
}) {
  return (
    <RegistryContext.Provider value={gitHubAtomRegistry}>
      <GitHubPostResourceActionsContent
        organizationId={organizationId}
        postId={postId}
      />
    </RegistryContext.Provider>
  );
}

function GitHubPostResourceActionsContent({
  organizationId,
  postId,
}: {
  readonly organizationId: string;
  readonly postId: string;
}) {
  const [action, setAction] = useState<GitHubPostAction>(null);
  const refreshPostExternalResources = usePostExternalResourceRefresh();
  const connectionsResult = useAtomValue(gitHubConnectionsAtom(organizationId));
  const hasActiveConnection = AsyncResult.match(connectionsResult, {
    onInitial: () => null as boolean | null,
    onFailure: ({ previousSuccess }) =>
      Option.match(previousSuccess, {
        onNone: () => false,
        onSome: ({ value }) =>
          value.some((connection) => connection.lifecycle === "active"),
      }),
    onSuccess: ({ value }) =>
      value.some((connection) => connection.lifecycle === "active"),
  });

  // While the installations are still loading, render nothing so the menu
  // never flashes a stale or "not connected" state.
  if (hasActiveConnection === null) {
    return null;
  }
  // Without an active installation the issue actions would dead-end in an
  // empty dialog, so surface a single muted status row instead.
  if (!hasActiveConnection) {
    return (
      <MenuItem disabled>
        <HugeiconsIcon icon={GithubIcon} />
        GitHub not connected
      </MenuItem>
    );
  }
  return (
    <>
      <MenuItem onClick={() => setAction("create")}>
        <HugeiconsIcon icon={PlusSignIcon} />
        Create a new GitHub issue
      </MenuItem>
      <MenuItem onClick={() => setAction("link")}>
        <HugeiconsIcon icon={Link01Icon} />
        Link an existing GitHub issue
      </MenuItem>
      {action ? (
        <GitHubPostIssueDialog
          action={action}
          onChanged={refreshPostExternalResources}
          onOpenChange={(open) => {
            if (!open) {
              setAction(null);
            }
          }}
          organizationId={organizationId}
          postId={postId}
        />
      ) : null}
    </>
  );
}

function GitHubPostIssueDialog({
  action,
  organizationId,
  postId,
  onChanged,
  onOpenChange,
}: {
  readonly action: GitHubPostIssueAction;
  readonly organizationId: string;
  readonly postId: string;
  readonly onChanged: () => void;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const connectionsResult = useAtomValue(gitHubConnectionsAtom(organizationId));
  const connections = AsyncResult.match(connectionsResult, {
    onInitial: () => null as readonly GitHubConnection[] | null,
    onFailure: ({ previousSuccess }) =>
      Option.getOrNull(previousSuccess)?.value ?? [],
    onSuccess: ({ value }) => value,
  });

  return (
    <Dialog onOpenChange={onOpenChange} open>
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>
            {action === "create"
              ? "Create a GitHub issue"
              : "Link a GitHub issue"}
          </DialogTitle>
          <DialogDescription>
            {action === "create"
              ? "Create an issue from this feedback post. The Feeblo bot will add a link back to this discussion."
              : "Link this feedback post to an existing GitHub issue. The Feeblo bot will add a link back to this discussion as a comment."}
          </DialogDescription>
        </DialogHeader>
        {connections === null ? (
          <DialogPanel>
            <p className="text-muted-foreground text-sm">
              Loading GitHub App installations…
            </p>
          </DialogPanel>
        ) : (
          <GitHubPostIssueForm
            action={action}
            connections={connections}
            onChanged={onChanged}
            onOpenChange={onOpenChange}
            organizationId={organizationId}
            postId={postId}
          />
        )}
      </DialogPopup>
    </Dialog>
  );
}

function GitHubPostIssueForm({
  action,
  connections,
  organizationId,
  postId,
  onChanged,
  onOpenChange,
}: {
  readonly action: GitHubPostIssueAction;
  readonly connections: readonly GitHubConnection[];
  readonly organizationId: string;
  readonly postId: string;
  readonly onChanged: () => void;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const form = useAppForm({
    ...githubPostIssueFormOpts,
    defaultValues: {
      action,
      connectionId: String(connections[0]?.id ?? ""),
      repositoryFullName: "",
      issueNumber: "",
    },
    onSubmit: async ({ value }) => {
      const [repositoryOwner, repositoryName] =
        value.repositoryFullName.split("/");
      const input = {
        organizationId,
        postId,
        connectionId: value.connectionId,
        repositoryOwner: repositoryOwner ?? "",
        repositoryName: repositoryName ?? "",
        idempotencyKey,
      };
      try {
        if (value.action === "create") {
          await createGitHubPostIssue(input);
        } else {
          await linkGitHubPostIssue({
            ...input,
            issueNumber: Number(value.issueNumber),
          });
        }
        onChanged();
        onOpenChange(false);
        toastManager.add({
          title:
            value.action === "create"
              ? "GitHub issue created by Feeblo bot"
              : "GitHub issue linked and Feeblo bot comment added",
          type: "success",
        });
      } catch {
        toastManager.add({
          title:
            value.action === "create"
              ? "Could not create GitHub issue"
              : "Could not link GitHub issue or add the Feeblo bot comment",
          type: "error",
        });
      }
    },
  });

  const connectionId = useSelector(
    form.store,
    (state) => state.values.connectionId
  );
  const repositoriesResult = useAtomValue(
    gitHubRepositoriesAtom({ organizationId, connectionId })
  );
  const repositories = AsyncResult.match(repositoriesResult, {
    onInitial: () => ({
      list: [] as readonly GitHubRepository[],
      isLoading: true,
    }),
    onFailure: ({ previousSuccess }) =>
      Option.match(previousSuccess, {
        onNone: () => ({
          list: [] as readonly GitHubRepository[],
          isLoading: false,
        }),
        onSome: ({ value }) => ({ list: value, isLoading: false }),
      }),
    onSuccess: ({ value }) => ({ list: value, isLoading: false }),
  });

  const submitLabel = action === "create" ? "Create issue" : "Link issue";

  return (
    <form
      className="contents"
      data-slot="form"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        form.handleSubmit();
      }}
    >
      <DialogPanel className="grid gap-4">
        <GitHubConnectionField connections={connections} form={form} />
        <GitHubRepositoryField
          disabled={repositories.isLoading}
          form={form}
          repositories={repositories.list}
        />
        {action === "link" ? (
          <form.AppField
            children={(field) => (
              <field.TextField
                inputMode="numeric"
                label="Issue number"
                min="1"
                placeholder="42"
                type="number"
              />
            )}
            name="issueNumber"
          />
        ) : null}
      </DialogPanel>
      <DialogFooter>
        <DialogClose render={<Button type="button" variant="outline" />}>
          Cancel
        </DialogClose>
        <form.AppForm>
          <form.SubscribeButton label={submitLabel} />
        </form.AppForm>
      </DialogFooter>
    </form>
  );
}
