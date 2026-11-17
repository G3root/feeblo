import { HELP_CENTER_ARTICLE_WRITE_STATES } from "@feeblo/domain-contracts/help-center-article";
import { formOptions } from "@tanstack/react-form";
import { z } from "zod";

import {
  DEFAULT_HELP_CENTER_TOPIC_ICON,
  HELP_CENTER_TOPIC_ICON_KEYS,
  type THelpCenterTopicIcon,
} from "./components/help-center-topic-icons";

/**
 * The topic form's shape, and the labels its controls render.
 *
 * The schema mirrors the server's bounds rather than defining them: a courtesy
 * check that turns a round trip into an inline message, with the RPC as the
 * enforcement point. `icon` is an enum over the catalogue, so a stored value
 * the picker cannot render is a validation failure instead of an empty tile.
 */
export const helpCenterTopicFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "A section needs a name.")
    .max(100, "Use 100 characters or fewer."),
  description: z.string().trim().max(500, "Use 500 characters or fewer."),
  icon: z.enum(HELP_CENTER_TOPIC_ICON_KEYS),
});

export type HelpCenterTopicFormValues = z.infer<
  typeof helpCenterTopicFormSchema
>;

/**
 * The values a topic dialog opens with.
 *
 * One helper for both variants: the create dialog passes nothing and gets an
 * empty form, the edit dialog passes the row. The dialog mounts its form only
 * while it is open, so this runs once per open and the form resets itself by
 * being a new component.
 */
export const helpCenterTopicFormValues = (
  topic?: {
    readonly description: string | null;
    readonly icon: string | null;
    readonly name: string;
  },
  fallbackIcon: THelpCenterTopicIcon = DEFAULT_HELP_CENTER_TOPIC_ICON
): HelpCenterTopicFormValues => ({
  description: topic?.description ?? "",
  // `find` over the tuple already narrows to the icon union, so the fallback is
  // the only `undefined` it can return.
  icon:
    HELP_CENTER_TOPIC_ICON_KEYS.find((key) => key === topic?.icon) ??
    fallbackIcon,
  name: topic?.name ?? "",
});

export const helpCenterTopicFormOptions = formOptions({
  defaultValues: helpCenterTopicFormValues(),
  validators: {
    onSubmit: helpCenterTopicFormSchema,
  },
});

/**
 * The article form's shape.
 *
 * `status` is the write vocabulary, not the full state union: a create may name
 * any initial state, and the editor narrows the *offered* options to the moves
 * the lifecycle graph permits from where the article is now.
 */
export const helpCenterArticleFormSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, "An article needs a title.")
    .max(200, "Use 200 characters or fewer."),
  slug: z.string().trim().max(200, "Use 200 characters or fewer."),
  // A section is required by the table, so the form refuses the empty state
  // rather than letting the server answer it.
  topicId: z.string().min(1, "Choose a section for this article."),
  status: z.enum(HELP_CENTER_ARTICLE_WRITE_STATES),
  /**
   * Declared so the form's value type and its validator agree, with no rule:
   * the body is unbounded Markdown, and the preview subscribes to it like any
   * other field.
   */
  content: z.string(),
});

export type HelpCenterArticleFormValues = z.infer<
  typeof helpCenterArticleFormSchema
>;

/**
 * The initial values for the two editor variants.
 *
 * The body is not in the schema above: it is unbounded Markdown with no
 * cross-field rule, so validating it through the form would only add a field
 * the schema has nothing to say about. It is a form value all the same, held
 * under `content` so the preview subscribes to it like any other.
 */
export const helpCenterArticleFormValues = (article?: {
  readonly content: string;
  readonly slug: string;
  readonly status: HelpCenterArticleFormValues["status"];
  readonly title: string;
  readonly topicId: string;
}): HelpCenterArticleFormValues => ({
  content: article?.content ?? "",
  slug: article?.slug ?? "",
  status: article?.status ?? "draft",
  title: article?.title ?? "",
  topicId: article?.topicId ?? "",
});

export const helpCenterArticleFormOptions = formOptions({
  defaultValues: helpCenterArticleFormValues(),
  validators: {
    onSubmit: helpCenterArticleFormSchema,
  },
});
