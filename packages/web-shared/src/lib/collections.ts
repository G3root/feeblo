import type { PostReaction } from "@feeblo/domain/src/post-reaction/schema";
import type { Upvote } from "@feeblo/domain/upvote/schema";
import { queryCollectionOptions } from "@tanstack/query-db-collection";
import { createCollection, parseLoadSubsetOptions } from "@tanstack/react-db";
import type { Schema } from "effect";
import { getContext } from "../integrations/tanstack-query/root-provider";
import {
  getPostReactionCollectionKey,
  getUpvoteCollectionKey,
} from "./reaction-keys";
import { fetchRpc } from "./runtime";

type UpvoteRow = Schema.Schema.Type<typeof Upvote>;
type PostReactionRow = Schema.Schema.Type<typeof PostReaction>;

const queryClient = getContext().queryClient;

function getCurrentOrganizationId() {
  if (typeof window === "undefined") {
    return undefined;
  }

  const [organizationId] = window.location.pathname
    .split("/")
    .filter((segment) => segment.length > 0);

  return organizationId ? decodeURIComponent(organizationId) : undefined;
}

function getOrganizationScopedQueryKey(
  scope: string,
  ...parts: ReadonlyArray<string | undefined>
) {
  const organizationId = getCurrentOrganizationId();
  const key = organizationId ? [scope, organizationId] : [scope];

  for (const part of parts) {
    if (part) {
      key.push(part);
    }
  }

  return key;
}

function getEqFilterValue(
  filters: ReadonlyArray<{
    field: ReadonlyArray<string | number>;
    operator: string;
    value?: unknown;
  }>,
  fieldName: string
) {
  for (const { field, operator, value } of filters) {
    if (operator === "eq" && field.join(".") === fieldName) {
      return value as string;
    }
  }

  return undefined;
}

export const postCollection = createCollection(
  queryCollectionOptions({
    queryKey: () => getOrganizationScopedQueryKey("post"),
    queryFn: async (ctx) => {
      const organizationId = getCurrentOrganizationId();

      if (!organizationId) {
        return [];
      }

      const boardId: string | null = null;

      const data = await fetchRpc(
        (rpc) => rpc.PostList({ boardId, organizationId }),
        {
          signal: ctx.signal,
        }
      );

      return [...data];
    },
    queryClient,
    getKey: (item) => item.id,
    onUpdate: async ({ transaction }) => {
      const mutation = transaction.mutations[0];
      const { modified: updatedPost } = mutation;

      await fetchRpc((rpc) =>
        rpc.PostUpdate({
          id: updatedPost.id,
          statusId: updatedPost.statusId,
          content: updatedPost.content,
          title: updatedPost.title,
          boardId: updatedPost.boardId,
          organizationId: updatedPost.organizationId,
        })
      );
    },
    onDelete: async ({ transaction }) => {
      const mutation = transaction.mutations[0];
      const { original: deletedPost } = mutation;

      await fetchRpc((rpc) =>
        rpc.PostDelete({
          id: deletedPost.id,
          boardId: deletedPost.boardId,
          organizationId: deletedPost.organizationId,
        })
      );
    },
    onInsert: async ({ transaction }) => {
      const mutation = transaction.mutations[0];
      const { modified: newPost } = mutation;

      await fetchRpc((rpc) =>
        rpc.PostCreate({
          id: newPost.id,
          boardId: newPost.boardId,
          organizationId: newPost.organizationId,
          title: newPost.title,
          content: newPost.content,
          statusId: newPost.statusId,
        })
      );
    },
  })
);

export const upvoteCollection = createCollection(
  queryCollectionOptions({
    queryKey: (opts) => {
      const parsed = parseLoadSubsetOptions(opts);
      const postId = getEqFilterValue(parsed.filters, "postId");

      return postId
        ? getOrganizationScopedQueryKey("upvote", "postId", postId)
        : getOrganizationScopedQueryKey("upvote");
    },
    syncMode: "on-demand",
    queryFn: async (ctx) => {
      const organizationId = getCurrentOrganizationId();
      const parsed = parseLoadSubsetOptions(ctx.meta?.loadSubsetOptions);
      const postId = getEqFilterValue(parsed.filters, "postId");

      if (!(organizationId && postId)) {
        return [];
      }

      const data = await fetchRpc(
        (rpc) => rpc.UpvoteList({ organizationId, postId }),
        {
          signal: ctx.signal,
        }
      );
      return [...data];
    },
    queryClient,
    getKey: getUpvoteCollectionKey as (item: UpvoteRow) => string,
    onInsert: async ({ transaction }) => {
      const mutation = transaction.mutations[0];
      const { modified: newUpvote } = mutation;

      await fetchRpc((rpc) =>
        rpc.UpvoteToggle({
          organizationId: newUpvote.organizationId,
          postId: newUpvote.postId,
        })
      );
    },
    onDelete: async ({ transaction }) => {
      const mutation = transaction.mutations[0];
      const { original: deletedUpvote } = mutation;

      await fetchRpc((rpc) =>
        rpc.UpvoteToggle({
          organizationId: deletedUpvote.organizationId,
          postId: deletedUpvote.postId,
        })
      );
    },
  })
);

export const postReactionCollection = createCollection(
  queryCollectionOptions({
    queryKey: (opts) => {
      const parsed = parseLoadSubsetOptions(opts);
      const postId = getEqFilterValue(parsed.filters, "postId");

      return postId
        ? getOrganizationScopedQueryKey("post-reaction", "postId", postId)
        : getOrganizationScopedQueryKey("post-reaction");
    },
    syncMode: "on-demand",
    queryFn: async (ctx) => {
      const organizationId = getCurrentOrganizationId();
      const parsed = parseLoadSubsetOptions(ctx.meta?.loadSubsetOptions);
      const postId = getEqFilterValue(parsed.filters, "postId");

      if (!(organizationId && postId)) {
        return [];
      }

      const data = await fetchRpc(
        (rpc) => rpc.PostReactionList({ organizationId, postId }),
        {
          signal: ctx.signal,
        }
      );
      return [...data];
    },
    queryClient,
    getKey: getPostReactionCollectionKey as (item: PostReactionRow) => string,
    onInsert: async ({ transaction }) => {
      const mutation = transaction.mutations[0];
      const { modified: newPostReaction } = mutation;

      await fetchRpc((rpc) =>
        rpc.PostReactionToggle({
          organizationId: newPostReaction.organizationId,
          postId: newPostReaction.postId,
          emoji: newPostReaction.emoji,
        })
      );
    },
    onDelete: async ({ transaction }) => {
      const mutation = transaction.mutations[0];
      const { original: deletedPostReaction } = mutation;

      await fetchRpc((rpc) =>
        rpc.PostReactionToggle({
          organizationId: deletedPostReaction.organizationId,
          postId: deletedPostReaction.postId,
          emoji: deletedPostReaction.emoji,
        })
      );
    },
  })
);

export const dashboardCollections = {
  postCollection,
  upvoteCollection,
  postReactionCollection,
};

export type DashboardCollections = typeof dashboardCollections;
