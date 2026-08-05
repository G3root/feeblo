/** biome-ignore-all lint/performance/noBarrelFile: intentional barrel file for compound component API */
import { FeedbackFormActions, FeedbackFormActionsSecondary } from "./actions";
import { FeedbackFormBackButton } from "./back-button";
import { FeedbackFormContentField } from "./content-field";
import { FeedbackFormFrame } from "./feedback-form";
import { FeedbackFormFields } from "./fields";
import { FeedbackFormError } from "./form-error";
import { FeedbackFormHeader } from "./header";
import { BoardNotFound } from "./not-found";
import { FeedbackFormProvider } from "./provider";
import { FeedbackFormSubmitButton } from "./submit-button";
import { FeedbackSuccess } from "./success-view";
import { FeedbackFormSuggestions } from "./suggestions";
import { FeedbackFormTitleField } from "./title-field";

export const FeedbackForm = {
  Provider: FeedbackFormProvider,
  Frame: FeedbackFormFrame,
  Header: FeedbackFormHeader,
  Fields: FeedbackFormFields,
  TitleField: FeedbackFormTitleField,
  ContentField: FeedbackFormContentField,
  Suggestions: FeedbackFormSuggestions,
  Actions: FeedbackFormActions,
  ActionsSecondary: FeedbackFormActionsSecondary,
  BackButton: FeedbackFormBackButton,
  SubmitButton: FeedbackFormSubmitButton,
  Error: FeedbackFormError,
  Success: FeedbackSuccess,
  NotFound: BoardNotFound,
};

export { useFeedbackForm } from "./context";
