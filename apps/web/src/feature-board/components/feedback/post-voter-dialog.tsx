import { and, eq, useLiveQuery } from "@tanstack/react-db";
import { createContext, type ReactNode, use } from "react";
import {
  Avatar,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
  AvatarImage,
} from "~/components/ui/avatar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogTitle,
  DialogTrigger,
} from "~/components/ui/dialog";
import { cn } from "~/lib/utils";
import { getInitials } from "../../lib/utils";
import { usePublicCollections } from "../../providers/public-collections-provider";
import { useSite } from "../../providers/site-provider";

type PostVoter = {
  id: string;
  user: {
    image: string | null;
    name: string;
  };
};

type PostVoterDialogContextValue = {
  hiddenVoterCount: number;
  visibleVoters: PostVoter[];
  voters: PostVoter[];
  voterCount: number;
};

const PostVoterDialogContext =
  createContext<PostVoterDialogContextValue | null>(null);

function usePostVoterDialog() {
  const value = use(PostVoterDialogContext);

  if (!value) {
    throw new Error("PostVoterDialog components must be used within Root.");
  }

  return value;
}

function PostVoterDialogRoot({
  children,
  postId,
}: {
  children: ReactNode;
  postId: string;
}) {
  const site = useSite();
  const organizationId = site.organizationId;
  const { publicUpvoteCollection } = usePublicCollections();
  const { data: upvotes } = useLiveQuery(
    (q) =>
      q
        .from({ upvote: publicUpvoteCollection })
        .where(({ upvote }) =>
          and(
            eq(upvote.postId, postId),
            eq(upvote.organizationId, organizationId)
          )
        )
        .orderBy(({ upvote }) => upvote.createdAt, "asc"),
    [organizationId, postId]
  );

  if (!upvotes?.length) {
    return null;
  }

  const voters = upvotes as PostVoter[];
  const visibleVoters = voters.slice(0, 4);
  const hiddenVoterCount = Math.max(voters.length - visibleVoters.length, 0);

  return (
    <PostVoterDialogContext
      value={{
        hiddenVoterCount,
        visibleVoters,
        voters,
        voterCount: voters.length,
      }}
    >
      <Dialog>{children}</Dialog>
    </PostVoterDialogContext>
  );
}

function PostVoterDialogTrigger() {
  const { hiddenVoterCount, visibleVoters, voterCount } = usePostVoterDialog();

  return (
    <DialogTrigger
      render={(props) => (
        <button
          aria-label={`View all ${voterCount} voters`}
          className={cn(
            "cursor-pointer rounded-xl focus-visible:outline-none",
            "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          )}
          type="button"
          {...props}
        >
          <AvatarGroup>
            {visibleVoters.map((voter) => (
              <Avatar key={voter.id}>
                <AvatarImage src={voter.user.image ?? undefined} />
                <AvatarFallback>{getInitials(voter.user.name)}</AvatarFallback>
              </Avatar>
            ))}
            {hiddenVoterCount > 0 ? (
              <AvatarGroupCount>+{hiddenVoterCount}</AvatarGroupCount>
            ) : null}
          </AvatarGroup>
        </button>
      )}
    />
  );
}

function PostVoterDialogContent() {
  const { voterCount, voters } = usePostVoterDialog();

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Voters</DialogTitle>
        <DialogDescription>
          {voterCount} {voterCount === 1 ? "person has" : "people have"} voted
          on this post.
        </DialogDescription>
      </DialogHeader>
      <DialogPanel className="flex flex-col gap-1">
        <ul className="-mx-2">
          {voters.map((voter) => (
            <li key={voter.id}>
              <div className="flex items-center gap-3 rounded-xl px-2 py-2">
                <Avatar>
                  <AvatarImage src={voter.user.image ?? undefined} />
                  <AvatarFallback>
                    {getInitials(voter.user.name)}
                  </AvatarFallback>
                </Avatar>
                <span className="font-medium text-foreground text-sm">
                  {voter.user.name}
                </span>
              </div>
            </li>
          ))}
        </ul>
      </DialogPanel>
    </DialogContent>
  );
}

export const PostVoterDialog = {
  Root: PostVoterDialogRoot,
  Trigger: PostVoterDialogTrigger,
  Content: PostVoterDialogContent,
};
