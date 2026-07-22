import { AvatarGroup, AvatarGroupCount } from "@feeblo/ui/avatar";
import { Button } from "@feeblo/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
  DialogTrigger,
} from "@feeblo/ui/dialog";
import { UserAvatar } from "@feeblo/web-shared/components/user-avatar";
import { and, eq, useLiveQuery } from "@tanstack/react-db";
import { createContext, type ReactNode, use } from "react";
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
  return (
    <DialogTrigger
      render={(props) => (
        <Button size="xs" variant="ghost" {...props}>
          See all
        </Button>
      )}
    />
  );
}

function PostVoterList() {
  const { hiddenVoterCount, visibleVoters } = usePostVoterDialog();

  return (
    <AvatarGroup>
      {visibleVoters.map((voter) => (
        <UserAvatar
          image={voter.user.image}
          key={voter.id}
          name={voter.user.name}
        />
      ))}
      {hiddenVoterCount > 0 ? (
        <AvatarGroupCount>+{hiddenVoterCount}</AvatarGroupCount>
      ) : null}
    </AvatarGroup>
  );
}

function PostVoterDialogPopup() {
  const { voterCount, voters } = usePostVoterDialog();

  return (
    <DialogPopup>
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
                <UserAvatar image={voter.user.image} name={voter.user.name} />
                <span className="font-medium text-foreground text-sm">
                  {voter.user.name}
                </span>
              </div>
            </li>
          ))}
        </ul>
      </DialogPanel>
    </DialogPopup>
  );
}

export const PostVoterDialog = {
  Root: PostVoterDialogRoot,
  Trigger: PostVoterDialogTrigger,
  Content: PostVoterDialogPopup,
  Items: PostVoterList,
};
