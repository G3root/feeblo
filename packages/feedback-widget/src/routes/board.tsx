import { createRoute, useParams } from "@tanstack/react-router";
import { FeedbackForm, useFeedbackForm } from "../components/feedback-form";
import { getBoard } from "../lib/boards";
import { rootRoute } from "./__root";

export const boardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/board/$boardId",
  component: BoardDetailComponent,
});

function BoardDetailComponent() {
  const { boardId } = useParams({ from: "/board/$boardId" });
  const board = getBoard(boardId);

  if (!board) {
    return <FeedbackForm.NotFound />;
  }

  return (
    <FeedbackForm.Provider board={board}>
      <FeedbackFormView />
    </FeedbackForm.Provider>
  );
}

function FeedbackFormView() {
  const {
    state: { submitted },
  } = useFeedbackForm();

  if (submitted) {
    return <FeedbackForm.Success />;
  }

  return (
    <FeedbackForm.Frame>
      <FeedbackForm.Header />
      <FeedbackForm.Fields>
        <FeedbackForm.TitleField />
        <FeedbackForm.DetailsField />
      </FeedbackForm.Fields>
      <FeedbackForm.Actions>
        <FeedbackForm.BackButton />
        <FeedbackForm.ActionsSecondary>
          {/* <Button variant="outline">
            <HugeiconsIcon className="size-4" icon={Camera01Icon} />
            Take a screenshot
          </Button> */}
          <FeedbackForm.SubmitButton />
        </FeedbackForm.ActionsSecondary>
      </FeedbackForm.Actions>
    </FeedbackForm.Frame>
  );
}
