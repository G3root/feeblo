import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@feeblo/ui/alert-dialog";
import { Button, buttonVariants } from "@feeblo/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@feeblo/ui/dropdown-menu";
import {
  ArrowLeft01Icon,
  Delete02Icon,
  Ellipsis,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { cn } from "~/lib/utils";

type PostPageActionsProps = {
  canDelete: boolean;
  onDelete: () => Promise<void>;
};

export function PostPageActions({ canDelete, onDelete }: PostPageActionsProps) {
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = async () => {
    setIsDeleting(true);

    try {
      await onDelete();
      setDeleteDialogOpen(false);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <>
      <AlertDialog onOpenChange={setDeleteDialogOpen} open={deleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete post</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently delete the
              post.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={isDeleting}
              onClick={handleDelete}
              variant="destructive"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="mb-8 flex items-center justify-between gap-2">
        <Link
          aria-label="Back"
          className={cn(
            buttonVariants({ size: "icon-sm", variant: "outline" })
          )}
          to="/"
        >
          <HugeiconsIcon icon={ArrowLeft01Icon} />
        </Link>

        {canDelete ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={(props) => (
                <Button
                  {...props}
                  aria-label="More actions"
                  size="icon-sm"
                  variant="outline"
                >
                  <HugeiconsIcon icon={Ellipsis} />
                </Button>
              )}
            />
            <DropdownMenuContent align="start" className="w-40">
              <DropdownMenuItem
                onClick={() => setDeleteDialogOpen(true)}
                variant="destructive"
              >
                <HugeiconsIcon icon={Delete02Icon} />
                <span>Delete</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
    </>
  );
}
