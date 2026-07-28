import type { TFeedbackTriageItem } from "@feeblo/domain/feedback-ingestion/schema";
import { Badge } from "@feeblo/ui/badge";
import { Button } from "@feeblo/ui/button";
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardPanel,
  CardTitle,
} from "@feeblo/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@feeblo/ui/empty";
import { Field, FieldLabel } from "@feeblo/ui/field";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "@feeblo/ui/select";
import { Spinner } from "@feeblo/ui/spinner";
import { toastManager } from "@feeblo/ui/toast";
import { MessageMultiple01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { eq, useLiveQuery } from "@tanstack/react-db";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { fetchRpc } from "~/lib/runtime";
import { useDashboardCollections } from "~/providers/dashboard-collections-provider";

const refreshMs = 15_000;

type IncomingFeedbackPageProps = {
  organizationId: string;
};

export function IncomingFeedbackPage({
  organizationId,
}: IncomingFeedbackPageProps) {
  const queryClient = useQueryClient();
  const { boardCollection, postCollection, postStatusCollection } =
    useDashboardCollections();
  const { data: boards = [] } = useLiveQuery(
    (q) =>
      q
        .from({ board: boardCollection })
        .where(({ board }) => eq(board.organizationId, organizationId))
        .orderBy(({ board }) => board.createdAt, "asc"),
    [organizationId]
  );
  const { data: statuses = [] } = useLiveQuery(
    (q) =>
      q
        .from({ status: postStatusCollection })
        .where(({ status }) => eq(status.organizationId, organizationId))
        .orderBy(({ status }) => status.orderIndex, "asc"),
    [organizationId]
  );
  const { data: posts = [] } = useLiveQuery(
    (q) =>
      q
        .from({ post: postCollection })
        .where(({ post }) => eq(post.organizationId, organizationId))
        .orderBy(({ post }) => post.updatedAt, "desc"),
    [organizationId]
  );
  const triageItems = useQuery({
    queryKey: ["feedback-triage", organizationId, "open"],
    queryFn: () =>
      fetchRpc((rpc) =>
        rpc.FeedbackTriageList({
          organizationId,
          status: "OPEN",
        })
      ),
    refetchInterval: refreshMs,
  });

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: ["feedback-triage", organizationId],
      }),
      postCollection.utils.refetch(),
    ]);
  };

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-5 p-4 pb-12 md:p-6">
      <header>
        <div className="flex items-center gap-2">
          <h1 className="font-semibold text-2xl text-wrap-balance">
            Incoming feedback
          </h1>
          {triageItems.data && (
            <Badge variant="secondary">{triageItems.data.length}</Badge>
          )}
        </div>
        <p className="mt-1 max-w-2xl text-muted-foreground text-sm">
          Review feedback captured from every source before it becomes a new
          post or a vote on an existing one.
        </p>
      </header>

      {triageItems.isLoading && (
        <div className="flex min-h-56 items-center justify-center">
          <Spinner className="size-5" />
        </div>
      )}

      {triageItems.isError && (
        <Card>
          <CardHeader>
            <CardTitle>Couldn’t load incoming feedback</CardTitle>
            <CardDescription>
              The queue is still intact. Retry the request to load it.
            </CardDescription>
          </CardHeader>
          <CardFooter>
            <Button
              onClick={() => triageItems.refetch()}
              type="button"
              variant="outline"
            >
              Retry
            </Button>
          </CardFooter>
        </Card>
      )}

      {triageItems.data?.length === 0 && (
        <Card>
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <HugeiconsIcon icon={MessageMultiple01Icon} />
              </EmptyMedia>
              <EmptyTitle>Inbox zero</EmptyTitle>
              <EmptyDescription>
                New feedback will appear here after the ingestion workflow has
                interpreted it.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        </Card>
      )}

      {triageItems.data?.map((triageItem) => (
        <FeedbackTriageCard
          boards={boards}
          key={triageItem.id}
          onResolved={refresh}
          organizationId={organizationId}
          posts={posts}
          statuses={statuses}
          triageItem={triageItem}
        />
      ))}
    </main>
  );
}

type SelectOption = {
  id: string;
  label: string;
};

type FeedbackTriageCardProps = {
  boards: ReadonlyArray<{ id: string; name: string }>;
  onResolved: () => Promise<void>;
  organizationId: string;
  posts: ReadonlyArray<{ id: string; title: string }>;
  statuses: ReadonlyArray<{ id: string; type: string }>;
  triageItem: TFeedbackTriageItem;
};

function FeedbackTriageCard({
  boards,
  onResolved,
  organizationId,
  posts,
  statuses,
  triageItem,
}: FeedbackTriageCardProps) {
  const [boardId, setBoardId] = useState(triageItem.proposedBoardId ?? "");
  const [statusId, setStatusId] = useState("");
  const [postId, setPostId] = useState(triageItem.proposedPostId ?? "");
  const [pendingAction, setPendingAction] = useState<
    "create" | "link" | "ignore" | null
  >(null);
  const boardOptions = boards.map((board) => ({
    id: board.id,
    label: board.name,
  }));
  const statusOptions = statuses.map((status) => ({
    id: status.id,
    label: formatStatus(status.type),
  }));
  const postOptions = posts.map((post) => ({
    id: post.id,
    label: post.title,
  }));
  const selectedBoardId = boardId || boardOptions[0]?.id || "";
  const selectedStatusId = statusId || statusOptions[0]?.id || "";
  const selectedPostId = postId || postOptions[0]?.id || "";
  const author =
    triageItem.senderName ?? triageItem.senderEmail ?? "Anonymous customer";

  const runAction = async (
    action: "create" | "link" | "ignore",
    request: () => Promise<unknown>
  ) => {
    setPendingAction(action);
    try {
      await request();
      await onResolved();
      toastManager.add({
        title: resolutionTitle(action),
        type: "success",
      });
    } catch {
      toastManager.add({
        title: "Couldn’t resolve this feedback",
        type: "error",
      });
    } finally {
      setPendingAction(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{triageItem.channelLabel}</Badge>
          <Badge variant={priorityVariant(triageItem.priority)}>
            {triageItem.priority ?? "UNASSESSED"}
          </Badge>
          {triageItem.tone && (
            <Badge variant="secondary">{triageItem.tone}</Badge>
          )}
        </div>
        <CardTitle className="mt-2">
          {triageItem.proposedTitle ?? triageItem.digest}
        </CardTitle>
        <CardDescription>
          {author} · {formatDate(triageItem.createdAt)}
        </CardDescription>
      </CardHeader>

      <CardPanel className="space-y-4">
        <p className="text-sm leading-6">{triageItem.digest}</p>
        {triageItem.customerNeed && (
          <div className="rounded-lg bg-muted/60 px-3 py-2">
            <p className="font-medium text-xs uppercase tracking-wide">
              Underlying need
            </p>
            <p className="mt-1 text-muted-foreground text-sm">
              {triageItem.customerNeed}
            </p>
          </div>
        )}
        {triageItem.excerpts.length > 0 && (
          <blockquote className="border-l-2 pl-3 text-muted-foreground text-sm italic">
            “{triageItem.excerpts[0]}”
          </blockquote>
        )}

        <div className="grid gap-3 border-t pt-4 md:grid-cols-2">
          <ResolutionSelect
            label="Board"
            onValueChange={setBoardId}
            options={boardOptions}
            placeholder="Select a board"
            value={selectedBoardId}
          />
          <ResolutionSelect
            label="Initial status"
            onValueChange={setStatusId}
            options={statusOptions}
            placeholder="Select a status"
            value={selectedStatusId}
          />
        </div>
        <Button
          disabled={!(selectedBoardId && selectedStatusId)}
          loading={pendingAction === "create"}
          onClick={() =>
            runAction("create", () =>
              fetchRpc((rpc) =>
                rpc.FeedbackTriageCreatePost({
                  organizationId,
                  triageItemId: triageItem.id,
                  boardId: selectedBoardId,
                  statusId: selectedStatusId,
                  ...(triageItem.proposedTitle
                    ? { title: triageItem.proposedTitle }
                    : {}),
                  ...(triageItem.proposedBody
                    ? { content: triageItem.proposedBody }
                    : {}),
                })
              )
            )
          }
          type="button"
        >
          Create post
        </Button>

        <div className="grid gap-3 border-t pt-4 md:grid-cols-[1fr_auto]">
          <ResolutionSelect
            label="Existing post"
            onValueChange={setPostId}
            options={postOptions}
            placeholder="Select a post"
            value={selectedPostId}
          />
          <Button
            className="self-end"
            disabled={!selectedPostId}
            loading={pendingAction === "link"}
            onClick={() =>
              runAction("link", () =>
                fetchRpc((rpc) =>
                  rpc.FeedbackTriageLinkPost({
                    organizationId,
                    triageItemId: triageItem.id,
                    postId: selectedPostId,
                  })
                )
              )
            }
            type="button"
            variant="outline"
          >
            Attach as vote
          </Button>
        </div>
      </CardPanel>

      <CardFooter className="justify-end">
        <Button
          loading={pendingAction === "ignore"}
          onClick={() =>
            runAction("ignore", () =>
              fetchRpc((rpc) =>
                rpc.FeedbackTriageIgnore({
                  organizationId,
                  triageItemId: triageItem.id,
                })
              )
            )
          }
          type="button"
          variant="ghost"
        >
          Dismiss
        </Button>
      </CardFooter>
    </Card>
  );
}

function ResolutionSelect({
  label,
  onValueChange,
  options,
  placeholder,
  value,
}: {
  label: string;
  onValueChange: (value: string) => void;
  options: readonly SelectOption[];
  placeholder: string;
  value: string;
}) {
  const items = Object.fromEntries(
    options.map((option) => [option.id, option.label])
  );

  return (
    <Field className="gap-1.5">
      <FieldLabel>{label}</FieldLabel>
      <Select
        items={items}
        onValueChange={(nextValue) => onValueChange(nextValue ?? "")}
        value={value || null}
      >
        <SelectTrigger className="w-full">
          <SelectValue placeholder={placeholder}>
            {options.find((option) => option.id === value)?.label}
          </SelectValue>
        </SelectTrigger>
        <SelectPopup>
          {options.map((option) => (
            <SelectItem key={option.id} value={option.id}>
              {option.label}
            </SelectItem>
          ))}
        </SelectPopup>
      </Select>
    </Field>
  );
}

function resolutionTitle(action: "create" | "link" | "ignore") {
  if (action === "create") {
    return "Feedback created as a post";
  }
  if (action === "link") {
    return "Feedback attached to the post";
  }
  return "Feedback ignored";
}

function formatStatus(status: string) {
  return status
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatDate(date: Date) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function priorityVariant(
  priority: TFeedbackTriageItem["priority"]
): "destructive" | "warning" | "secondary" {
  if (priority === "CRITICAL") {
    return "destructive";
  }
  if (priority === "HIGH") {
    return "warning";
  }
  return "secondary";
}
