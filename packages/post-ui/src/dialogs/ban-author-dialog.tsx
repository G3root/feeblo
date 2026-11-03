import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "@feeblo/ui/alert-dialog";
import { Button } from "@feeblo/ui/button";
import { Checkbox } from "@feeblo/ui/checkbox";
import { Label } from "@feeblo/ui/label";
import { Textarea } from "@feeblo/ui/textarea";
import { toastManager } from "@feeblo/ui/toast";
import { parseRpcError } from "@feeblo/web-shared/rpc-error";
import { fetchRpc } from "@feeblo/web-shared/runtime";
import { useSelector } from "@xstate/store-react";
import { useState } from "react";

import { useBanAuthorDialogContext } from "../dialog-stores/ban-author";
import { usePostCollectionData } from "../post-page-context";
import { usePostCollections } from "../providers/post-collections-provider";

/**
 * Confirms a ban for the author of a comment or a post.
 *
 * The account is named by the participation row, never by an account id the
 * client happens to have: the server resolves the author from a row this
 * workspace owns, so the request cannot be retargeted at another tenant's
 * account.
 */
export function BanAuthorDialog() {
  const store = useBanAuthorDialogContext();
  const open = useSelector(store, (state) => state.context.open);
  const data = useSelector(store, (state) => state.context.data);
  const { organizationId } = usePostCollectionData();
  const {
    collections: { commentCollection, postCollection },
  } = usePostCollections();
  const [deleteContent, setDeleteContent] = useState(false);
  const [reason, setReason] = useState("");
  const [isPending, setIsPending] = useState(false);

  const close = () => store.send({ type: "setOpen", open: false });

  const ban = async () => {
    setIsPending(true);
    try {
      const result = await fetchRpc((rpc) =>
        rpc.BanUser({
          deleteContent,
          organizationId,
          target: data.target,
          // Optional on the server; an empty box must not store "".
          ...(reason.trim() === "" ? undefined : { reason: reason.trim() }),
        })
      );
      close();
      setDeleteContent(false);
      setReason("");
      toastManager.add({
        title:
          result.deletedComments + result.deletedPosts > 0
            ? `Banned ${data.authorName} and deleted ${describeDeletedContent(result)}`
            : `Banned ${data.authorName}`,
        type: "success",
      });
      await commentCollection.utils.refetch();
      await postCollection.utils.refetch();
    } catch (error) {
      toastManager.add({
        title: parseRpcError(error).message,
        type: "error",
      });
    } finally {
      setIsPending(false);
    }
  };

  return (
    <AlertDialog
      onOpenChange={(nextOpen) => {
        // A dismissed dialog must not carry the delete choice, or a note
        // written for one comment, into the next one it is opened for.
        if (!nextOpen) {
          setDeleteContent(false);
          setReason("");
        }
        store.send({ type: "setOpen", open: nextOpen });
      }}
      open={open}
    >
      <AlertDialogPopup>
        <AlertDialogHeader>
          <AlertDialogTitle>Ban {data.authorName}?</AlertDialogTitle>
          <AlertDialogDescription>
            They will not be able to post, comment, vote, react, or subscribe in
            this workspace. Their votes are removed and they are unsubscribed
            from every post, changelog, and email subscription here. They can
            still read the board, and their existing posts and comments stay
            visible unless you delete them below.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="grid gap-2 px-6 pb-4">
          <Label className="text-sm font-normal" htmlFor="ban-author-reason">
            Reason (optional)
          </Label>
          <Textarea
            id="ban-author-reason"
            maxLength={500}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Spam, abuse, or a note for your team"
            value={reason}
          />
          {/* The reason is operator context, not a notice: the server never
              returns it on the banned person's own status read. Saying so here
              is what keeps somebody from writing a reply into the box. */}
          <p className="text-muted-foreground text-xs">
            Only your team sees this. The banned person is not told why.
          </p>
        </div>
        <div className="flex items-start gap-2 px-6 pb-4">
          <Checkbox
            checked={deleteContent}
            id="ban-author-delete-content"
            onCheckedChange={(checked) => setDeleteContent(checked)}
          />
          <Label
            className="text-sm font-normal"
            htmlFor="ban-author-delete-content"
          >
            Delete their existing posts and comments in this workspace. This
            cannot be undone.
          </Label>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
          <Button
            loading={isPending}
            onClick={() => {
              void ban();
            }}
            variant="destructive"
          >
            Ban user
          </Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}

const describeDeletedContent = (result: {
  deletedComments: number;
  deletedPosts: number;
}): string => {
  const parts = [
    result.deletedPosts === 0
      ? null
      : `${result.deletedPosts} ${result.deletedPosts === 1 ? "post" : "posts"}`,
    result.deletedComments === 0
      ? null
      : `${result.deletedComments} ${
          result.deletedComments === 1 ? "comment" : "comments"
        }`,
  ].filter((part): part is string => part !== null);
  return parts.join(" and ");
};
