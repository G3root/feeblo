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
import { Input } from "@feeblo/ui/input";
import { MenuItem } from "@feeblo/ui/menu";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "@feeblo/ui/select";
import { toastManager } from "@feeblo/ui/toast";
import { Link01Icon, PlusSignIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import * as Option from "effect/Option";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import { useMemo, useState } from "react";
import { usePostExternalResourceRefresh } from "~/features/integrations/components/post-external-resources";
import {
  gitHubAtomRegistry,
  gitHubConnectionsAtom,
  gitHubRepositoriesAtom,
} from "../atoms";
import {
  createGitHubPostIssue,
  linkGitHubPostIssue,
} from "../lib/github-connections";

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
  readonly action: Exclude<GitHubPostAction, null>;
  readonly organizationId: string;
  readonly postId: string;
  readonly onChanged: () => void;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const connectionsResult = useAtomValue(gitHubConnectionsAtom(organizationId));
  const connections = AsyncResult.match(connectionsResult, {
    onInitial: () => [],
    onFailure: ({ previousSuccess }) =>
      Option.getOrNull(previousSuccess)?.value ?? [],
    onSuccess: ({ value }) => value,
  });
  const [connectionId, setConnectionId] = useState("");
  const selectedConnectionId = connectionId || connections[0]?.id || "";
  const repositoriesResult = useAtomValue(
    gitHubRepositoriesAtom({
      organizationId,
      connectionId: selectedConnectionId,
    })
  );
  const repositories = AsyncResult.match(repositoriesResult, {
    onInitial: () => [],
    onFailure: ({ previousSuccess }) =>
      Option.getOrNull(previousSuccess)?.value ?? [],
    onSuccess: ({ value }) => value,
  });
  const [repositoryFullName, setRepositoryFullName] = useState("");
  const [issueNumber, setIssueNumber] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const submit = async () => {
    const [repositoryOwner, repositoryName] = repositoryFullName.split("/");
    const parsedIssueNumber = Number(issueNumber);
    if (
      !(
        selectedConnectionId &&
        repositoryOwner &&
        repositoryName &&
        (action === "create" ||
          (Number.isInteger(parsedIssueNumber) && parsedIssueNumber > 0))
      )
    ) {
      toastManager.add({
        title: "Choose a repository and enter a valid issue number",
        type: "error",
      });
      return;
    }
    setSubmitting(true);
    try {
      const input = {
        organizationId,
        postId,
        connectionId: selectedConnectionId,
        repositoryOwner,
        repositoryName,
        idempotencyKey: crypto.randomUUID(),
      };
      if (action === "create") {
        await createGitHubPostIssue(input);
      } else {
        await linkGitHubPostIssue({ ...input, issueNumber: parsedIssueNumber });
      }
      onChanged();
      onOpenChange(false);
      toastManager.add({
        title:
          action === "create"
            ? "GitHub issue created by Feeblo bot"
            : "GitHub issue linked and Feeblo bot comment added",
        type: "success",
      });
    } catch {
      toastManager.add({
        title:
          action === "create"
            ? "Could not create GitHub issue"
            : "Could not link GitHub issue or add the Feeblo bot comment",
        type: "error",
      });
    } finally {
      setSubmitting(false);
    }
  };
  const repositoryOptions = useMemo(
    () => repositories.map((repository) => repository.fullName),
    [repositories]
  );
  let submitLabel = "Link issue";
  if (submitting) {
    submitLabel = "Saving…";
  } else if (action === "create") {
    submitLabel = "Create issue";
  }
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
        <DialogPanel className="grid gap-4">
          <div className="grid gap-1.5 text-sm">
            <span>GitHub App installation</span>
            <Select
              onValueChange={(value) => {
                setConnectionId(String(value));
                setRepositoryFullName("");
              }}
              value={selectedConnectionId}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select a GitHub App installation" />
              </SelectTrigger>
              <SelectPopup>
                {connections.map((connection) => (
                  <SelectItem key={connection.id} value={connection.id}>
                    {connection.login ?? "GitHub installation"}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          </div>
          <div className="grid gap-1.5 text-sm">
            <span>Repository</span>
            <Select
              disabled={!selectedConnectionId}
              onValueChange={(value) => setRepositoryFullName(String(value))}
              value={repositoryFullName}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select a repository" />
              </SelectTrigger>
              <SelectPopup>
                {repositoryOptions.map((repository) => (
                  <SelectItem key={repository} value={repository}>
                    {repository}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          </div>
          {action === "link" ? (
            <div className="grid gap-1.5 text-sm">
              <span>Issue number</span>
              <Input
                inputMode="numeric"
                min="1"
                onChange={(event) => setIssueNumber(event.target.value)}
                placeholder="42"
                type="number"
                value={issueNumber}
              />
            </div>
          ) : null}
        </DialogPanel>
        <DialogFooter>
          <DialogClose render={<Button type="button" variant="outline" />}>
            Cancel
          </DialogClose>
          <Button
            disabled={
              submitting || !selectedConnectionId || !repositoryFullName
            }
            onClick={submit}
            type="button"
          >
            {submitLabel}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
