import { Schema } from "effect";

export class CompleteOnboardingInput extends Schema.Class<CompleteOnboardingInput>(
  "CompleteOnboardingInput"
)({
  workspaceName: Schema.String.pipe(Schema.minLength(3)),
}) {}

export class CompleteOnboardingOutput extends Schema.Class<CompleteOnboardingOutput>(
  "CompleteOnboardingOutput"
)({
  organizationId: Schema.String,
}) {}

export type TCompleteOnboardingInput = Schema.Schema.Type<
  typeof CompleteOnboardingInput
>;
