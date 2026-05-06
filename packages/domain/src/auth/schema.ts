import { Schema } from "effect";

export const VerificationOTPStateSchema = Schema.Struct({
  email: Schema.String,
  type: Schema.Literals(["email-verification", "reset-password"]),
});

export type VerificationOTPState = Schema.Schema.Type<
  typeof VerificationOTPStateSchema
>;

export const VerificationOTPResponseSchema = Schema.Struct({
  email: Schema.String,
  type: Schema.Literals(["email-verification", "reset-password"]),
});
