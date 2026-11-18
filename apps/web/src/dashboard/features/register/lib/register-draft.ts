import { PLAN_ENTITLEMENTS } from "@feeblo/domain/plan-entitlements";
import { isValidSubdomainLabel } from "@feeblo/utils/url";
import { z } from "zod";

/**
 * Everything the register wizard collects, in the shape the form holds it.
 *
 * One object for all four steps because that is what a draft is: a partial
 * workspace the reader fills in any order, with the machine deciding which part
 * they are looking at. Splitting it into a form per step would lose the answers
 * on Back.
 *
 * The schemas below are the only place an answer is judged complete. The
 * machine asks `isStepComplete`, the form shows the same messages, and neither
 * re-states a rule the other owns.
 */

/** The shortest subdomain the server accepts. */
export const minSubdomainLength = 4;

/**
 * How many boards a workspace may start with.
 *
 * Every new workspace begins on the free plan, so its allowance is the ceiling
 * here. The wizard could let a reader pick more and let the over-plan gate catch
 * it, but a workspace that is over its plan before it has a name is a bad first
 * minute, and the server refuses the same number.
 */
export const maxBoards =
  PLAN_ENTITLEMENTS.free.limits.feedbackBoards ?? Number.MAX_SAFE_INTEGER;

/** The longest board name, matching the column and the server's check. */
export const maxBoardNameLength = 60;

const workspaceNameSchema = z
  .string()
  .trim()
  .min(2, "Give the workspace a name")
  .max(60, "Use 60 characters or fewer");

const subdomainSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(minSubdomainLength, `Use at least ${minSubdomainLength} characters`)
  .max(63, "Use 63 characters or fewer")
  .refine(
    isValidSubdomainLabel,
    "Use lowercase letters, numbers and hyphens, and no leading or trailing hyphen"
  );

const boardSchema = z.object({
  /** Stable key for the array field; the name is the value the reader edits. */
  id: z.string(),
  name: z.string(),
  enabled: z.boolean(),
});

const boardsSchema = z
  .array(boardSchema)
  .max(maxBoards, `A new workspace starts with at most ${maxBoards} boards`)
  .refine(
    (boards) => boards.some((board) => board.enabled),
    "Keep at least one board"
  )
  .refine(
    (boards) =>
      boards.every((board) => !board.enabled || board.name.trim().length >= 2),
    "Give every selected board a name"
  )
  .refine(
    (boards) =>
      boards.every((board) => board.name.trim().length <= maxBoardNameLength),
    `Board names are ${maxBoardNameLength} characters or fewer`
  );

const invitesSchema = z
  .array(z.string())
  .refine(
    (invites) =>
      invites.every(
        (email) =>
          email.trim().length === 0 || z.email().safeParse(email).success
      ),
    "Enter a valid email address"
  );

/** The logo is a file the browser holds until the workspace exists to own it. */
const logoSchema = z.custom<File | null>(
  (value) => value === null || value instanceof File
);

export const registerDraftSchema = z.object({
  boards: boardsSchema,
  invites: invitesSchema,
  logo: logoSchema,
  subdomain: subdomainSchema,
  workspaceName: workspaceNameSchema,
});

/**
 * Declared rather than inferred from the zod schema.
 *
 * The schema's job is to answer yes or no; it is never used for the value it
 * would return, and `z.infer` would hand back mutable arrays that the wizard
 * machine's own schema types describe as readonly. One explicit shape keeps
 * the form, the machine and the payload agreeing on the same type.
 */
export type RegisterBoardDraft = {
  readonly enabled: boolean;
  /** Stable key for the array field, so removing a row cannot reorder the rest. */
  readonly id: string;
  readonly name: string;
};

export type RegisterDraft = {
  readonly boards: readonly RegisterBoardDraft[];
  readonly invites: readonly string[];
  readonly logo: File | null;
  readonly subdomain: string;
  readonly workspaceName: string;
};

/** The step ids, in the order the wizard walks them. */
export const registerStepIds = ["identity", "url", "boards", "team"] as const;

export type RegisterStepId = (typeof registerStepIds)[number];

/**
 * The fields each step owns.
 *
 * Parsing the whole draft against a step's slice is what makes "can I leave
 * this step" answerable without a chain of `if`s, and means a later field
 * cannot block an earlier step it is not part of.
 */
const stepSchemas: Record<RegisterStepId, z.ZodType> = {
  identity: z.object({ workspaceName: workspaceNameSchema }),
  url: z.object({ subdomain: subdomainSchema }),
  boards: z.object({ boards: boardsSchema }),
  team: z.object({ invites: invitesSchema }),
};

/**
 * Whether a step's own answers are good enough to leave.
 *
 * The url step is not the whole story: a well-formed subdomain that another
 * workspace already holds is not an answer, so the wizard adds the check's
 * verdict to this result.
 */
export const isStepComplete = (
  step: RegisterStepId,
  draft: RegisterDraft
): boolean => stepSchemas[step].safeParse(draft).success;

/** The two boards a workspace used to be created with, now just the default offer. */
export const initialBoards = (): readonly RegisterBoardDraft[] => [
  { enabled: true, id: "board-bugs", name: "Bugs 🐞" },
  { enabled: true, id: "board-features", name: "Features 💡" },
];

/** The draft a first render holds. */
export const initialDraft = (): RegisterDraft => ({
  boards: initialBoards(),
  invites: [],
  logo: null,
  subdomain: "",
  workspaceName: "",
});

/** The boards a create will write: enabled, named, trimmed, in the reader's order. */
export const selectedBoardNames = (draft: RegisterDraft): string[] =>
  draft.boards
    .filter((board) => board.enabled)
    .map((board) => board.name.trim())
    .filter((name) => name.length > 0);

/** The invites a create will send: typed, valid, de-duplicated, in order. */
export const selectedInvites = (draft: RegisterDraft): string[] => {
  const seen = new Set<string>();

  for (const invite of draft.invites) {
    const email = invite.trim().toLowerCase();

    if (email.length > 0) {
      seen.add(email);
    }
  }

  return [...seen];
};
