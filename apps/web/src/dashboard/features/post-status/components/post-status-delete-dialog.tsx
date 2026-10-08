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
import { toastManager } from "@feeblo/ui/toast";
import { eq, useLiveQuery } from "@tanstack/react-db";
import { useSelector } from "@xstate/store-react";
import { useEffect, useState } from "react";

import { useOrganizationId } from "~/hooks/use-organization-id";
import { fetchRpc } from "~/lib/runtime";
import { useDashboardCollections } from "~/providers/dashboard-collections-provider";

import { usePostStatusDeleteDialogContext } from "../dialog-stores";

type DeletePreview = {
  postCount: number;
  roadmapColumnCount: number;
  syncRuleCount: number;
};

const pluralize = (count: number, singular: string, plural: string) =>
  count === 1 ? singular : plural;

export function PostStatusDeleteDialog() {
  const store = usePostStatusDeleteDialogContext();
  const organizationId = useOrganizationId();
  const { postStatusCollection } = useDashboardCollections();
  const open = useSelector(store, (state) => state.context.open);
  const statusId = useSelector(store, (state) => state.context.data.statusId);
  const [preview, setPreview] = useState<DeletePreview | null>(null);
  const [previewError, setPreviewError] = useState(false);
  const [previewAttempt, setPreviewAttempt] = useState(0);
  const [pending, setPending] = useState(false);

  const statusQuery = useLiveQuery({
    query: (q) =>
      q
        .from({ postStatus: postStatusCollection })
        .where(({ postStatus }) =>
          eq(postStatus.organizationId, organizationId)
        ),
  });

  const statuses = statusQuery?.data ?? [];
  const status = statuses.find((row) => row.id === statusId);
  const fallback = statuses.find((row) => row.isDefault);

  // Read once per open, and again on retry: the numbers are what the dialog
  // promises, and they are cheap to re-read if the workspace changed
  // underneath it.
  useEffect(() => {
    if (!open) {
      setPreview(null);
      setPreviewError(false);
      return;
    }

    let cancelled = false;

    setPreview(null);
    setPreviewError(false);

    fetchRpc((rpc) =>
      rpc.PostStatusDeletePreview({ id: statusId, organizationId })
    )
      .then((result) => {
        if (!cancelled) {
          setPreview(result);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPreviewError(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [open, organizationId, statusId, previewAttempt]);

  const handlePreviewRetry = () => {
    setPreviewError(false);
    setPreviewAttempt((attempt) => attempt + 1);
  };

  const handleDelete = () => {
    if (!status || pending) {
      return;
    }

    setPending(true);
    void (async () => {
      try {
        // Deliberately not an optimistic collection delete: this runs a
        // transaction that repoints every post in the status, and the counts
        // it returns are what the toast reports.
        const result = await fetchRpc((rpc) =>
          rpc.PostStatusDelete({ id: status.id, organizationId })
        );

        await postStatusCollection.utils.refetch();
        store.send({ type: "toggle" });

        toastManager.add({
          title: `Status deleted. ${result.movedPostCount} ${pluralize(
            result.movedPostCount,
            "post was",
            "posts were"
          )} moved to ${fallback?.label ?? "the default status"}.`,
          type: "success",
        });
      } catch {
        toastManager.add({
          title: "Failed to delete status",
          type: "error",
        });
      } finally {
        setPending(false);
      }
    })();
  };

  return (
    <AlertDialog
      onOpenChange={() => store.send({ type: "toggle" })}
      open={open}
    >
      <AlertDialogPopup>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Delete {status?.label ?? "this status"}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            {previewError ? (
              <span className="flex items-center gap-2">
                Could not check what this status is used by.
                <Button
                  onClick={handlePreviewRetry}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  Try again
                </Button>
              </span>
            ) : preview === null ? (
              "Checking what this status is used by…"
            ) : (
              <>
                {preview.postCount === 0
                  ? "No posts use this status."
                  : `${preview.postCount} ${pluralize(
                      preview.postCount,
                      "post",
                      "posts"
                    )} will be moved to ${
                      fallback?.label ?? "the default status"
                    }.`}
                {preview.roadmapColumnCount > 0
                  ? ` ${preview.roadmapColumnCount} roadmap ${pluralize(
                      preview.roadmapColumnCount,
                      "column",
                      "columns"
                    )} will be removed.`
                  : ""}
                {preview.syncRuleCount > 0
                  ? ` ${preview.syncRuleCount} GitHub sync ${pluralize(
                      preview.syncRuleCount,
                      "rule",
                      "rules"
                    )} will be removed.`
                  : ""}{" "}
                This cannot be undone.
              </>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <Button
            disabled={pending || !status || preview === null}
            onClick={handleDelete}
            type="button"
            variant="destructive"
          >
            {pending ? "Deleting…" : "Delete status"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}
