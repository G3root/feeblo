/** biome-ignore-all lint/performance/noBarrelFile: intentional barrel file for compound component API */
import { FeedbackFormActions, FeedbackFormActionsSecondary } from "./actions";
import { FeedbackFormBackButton } from "./back-button";
import { FeedbackFormFrame } from "./feedback-form";
import { FeedbackFormFields } from "./fields";
import { FeedbackFormHeader } from "./header";
import { BoardNotFound } from "./not-found";
import { FeedbackSuccess } from "./success-view";

export const FeedbackForm = {
  Frame: FeedbackFormFrame,
  Header: FeedbackFormHeader,
  Fields: FeedbackFormFields,
  Actions: FeedbackFormActions,
  ActionsSecondary: FeedbackFormActionsSecondary,
  BackButton: FeedbackFormBackButton,
  Success: FeedbackSuccess,
  NotFound: BoardNotFound,
};
