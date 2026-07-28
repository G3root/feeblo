import type { FeedbackMessage, FeedbackSender } from "@feeblo/db/schema";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

export interface FeedbackAssessment {
  readonly customerNeed: string | null;
  readonly digest: string;
  readonly excerpts: readonly string[];
  readonly interpretationConfidence: number | null;
  readonly priority: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" | null;
  readonly proposal: {
    readonly action: "CREATE_POST" | "LINK_POST" | "REVIEW";
    readonly title: string | null;
    readonly body: string | null;
    readonly boardId: string | null;
    readonly postId: string | null;
    readonly rationale: string | null;
  };
  readonly tone: "NEGATIVE" | "NEUTRAL" | "POSITIVE" | null;
}

export interface FeedbackAssessmentInput {
  readonly message: FeedbackMessage;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly sender: FeedbackSender;
}

const compactWhitespace = (value: string) => value.replace(/\s+/g, " ").trim();
const sentenceEndPattern = /[.!?](?:\s|$)/;

const makeTitle = (message: FeedbackMessage): string => {
  const suppliedTitle = compactWhitespace(message.title ?? "");
  if (suppliedTitle) {
    return suppliedTitle.slice(0, 200);
  }

  const text = compactWhitespace(message.text);
  const sentenceEnd = text.search(sentenceEndPattern);
  const candidate = sentenceEnd > 0 ? text.slice(0, sentenceEnd) : text;
  return candidate.slice(0, 120);
};

export class FeedbackAssessor extends Context.Service<
  FeedbackAssessor,
  {
    readonly assess: (
      input: FeedbackAssessmentInput
    ) => Effect.Effect<FeedbackAssessment>;
  }
>()("FeedbackAssessor") {
  static readonly manualLayer = Layer.succeed(
    this,
    this.of({
      assess: Effect.fn("FeedbackAssessor.manual")(
        (input: FeedbackAssessmentInput) => {
          const normalizedText = compactWhitespace(input.message.text);

          return Effect.succeed({
            digest: normalizedText.slice(0, 1000),
            excerpts: [normalizedText.slice(0, 500)],
            customerNeed: null,
            tone: null,
            priority: null,
            interpretationConfidence: null,
            proposal: {
              action: "CREATE_POST",
              title: makeTitle(input.message),
              body: input.message.text.trim(),
              boardId: null,
              postId: null,
              rationale: "Captured from an external feedback channel",
            },
          } satisfies FeedbackAssessment);
        }
      ),
    })
  );
}
