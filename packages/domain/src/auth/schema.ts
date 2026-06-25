import { Schema as S } from "effect";

export const VerificationOTPStateSchema = S.Struct({
  email: S.String,
  type: S.Literals(["email-verification", "reset-password"]),
});

export type VerificationOTPState = S.Schema.Type<
  typeof VerificationOTPStateSchema
>;

export const VerificationOTPResponseSchema = S.Struct({
  email: S.String,
  type: S.Literals(["email-verification", "reset-password"]),
});
