/** biome-ignore-all lint/performance/noBarrelFile: <explanation> */
import { FeedbackFormActions, FeedbackFormActionsSecondary } from "./actions";
import { FeedbackFormBackButton } from "./back-button";
import { FeedbackFormContext } from "./context";
import { FeedbackFormDetailsField } from "./details-field";
import { FeedbackFormFrame } from "./feedback-form";
import { FeedbackFormFields } from "./fields";
import { FeedbackFormHeader } from "./header";
import { BoardNotFound } from "./not-found";
import { FeedbackFormProvider } from "./provider";
import { FeedbackFormSubmitButton } from "./submit-button";
import { FeedbackSuccess } from "./success-view";
import { FeedbackFormTitleField } from "./title-field";

export type {
  FeedbackFormActions,
  FeedbackFormContextValue,
  FeedbackFormMeta,
  FeedbackFormState,
} from "./context";
export { FeedbackFormContext, useFeedbackForm } from "./context";

export const FeedbackForm = {
  Provider: FeedbackFormProvider,
  Frame: FeedbackFormFrame,
  Header: FeedbackFormHeader,
  Fields: FeedbackFormFields,
  TitleField: FeedbackFormTitleField,
  DetailsField: FeedbackFormDetailsField,
  Actions: FeedbackFormActions,
  ActionsSecondary: FeedbackFormActionsSecondary,
  BackButton: FeedbackFormBackButton,
  SubmitButton: FeedbackFormSubmitButton,
  Success: FeedbackSuccess,
  NotFound: BoardNotFound,
  Context: FeedbackFormContext,
};
