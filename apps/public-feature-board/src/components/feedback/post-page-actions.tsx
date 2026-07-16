import { usePostDeleteDialogContext } from "@feeblo/post-ui/dialog-stores";
import { usePostCollectionData } from "@feeblo/post-ui/post-page-context";
import { Button, buttonVariants } from "@feeblo/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@feeblo/ui/dropdown-menu";
import { cn } from "@feeblo/ui/utils";
import {
  ArrowLeft01Icon,
  Delete02Icon,
  Ellipsis,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link } from "@tanstack/react-router";

export function PostPageActions() {
  const { canManagePost, post } = usePostCollectionData();
  const postId = post.id;

  const store = usePostDeleteDialogContext();

  return (
    <div className="mb-8 flex items-center justify-between gap-2">
      <Link
        aria-label="Back"
        className={cn(buttonVariants({ size: "icon-sm", variant: "outline" }))}
        search={{
          board: undefined,
          sort: undefined,
          status: undefined,
        }}
        to="/"
      >
        <HugeiconsIcon icon={ArrowLeft01Icon} />
      </Link>

      {canManagePost ? (
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
              onClick={() =>
                store.send({
                  type: "toggle",
                  data: { postId, redirectOptions: { to: "/" } },
                })
              }
              variant="destructive"
            >
              <HugeiconsIcon icon={Delete02Icon} />
              <span>Delete</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}
