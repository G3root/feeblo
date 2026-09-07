import { createContext, use } from "react";

export type CommentThreadContextValue = {
  /** Expands the replies accordion (no-op when already expanded). */
  expandReplies: () => void;
};

export const CommentThreadContext =
  createContext<CommentThreadContextValue | null>(null);

export function useCommentThread() {
  return use(CommentThreadContext);
}
