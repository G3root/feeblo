import { initialDraft, registerDraftSchema } from "./lib/register-draft";

/**
 * The form's options, shared so `withForm` can type a step against the same
 * draft the page holds.
 *
 * `defaultValues` here is a seed for that type, not the instance: the page
 * creates the form it renders, and `withForm` uses the one it is handed.
 */
export const registerFormOpts = {
  defaultValues: initialDraft(),
  validators: {
    onChange: registerDraftSchema,
  },
};
