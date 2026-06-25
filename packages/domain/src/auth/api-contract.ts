import { Schema } from "effect";
import {
  HttpApiEndpoint,
  HttpApiGroup,
  OpenApi,
} from "effect/unstable/httpapi";
import {
  BadRequestError,
  InternalServerError,
  NotFoundError,
} from "../rpc-errors";
import {
  VerificationOTPResponseSchema,
  VerificationOTPStateSchema,
} from "./schema";

export const VerificationOTPSuccessSchema = Schema.Struct({
  success: Schema.Boolean,
});

export const AuthApiGroup = HttpApiGroup.make("AuthApiGroup")
  .add(
    HttpApiEndpoint.post("postVerificationOtp", "/auth/verification-otp", {
      payload: VerificationOTPStateSchema,
      error: Schema.Union([BadRequestError, InternalServerError]),
      success: VerificationOTPSuccessSchema,
    })
      .annotate(OpenApi.Title, "Create Verification OTP")
      .annotate(
        OpenApi.Description,
        "Creates verification OTP state and stores it in a cookie"
      )
      .annotate(OpenApi.Summary, "Create verification OTP")
  )
  .add(
    HttpApiEndpoint.get("getVerificationOtp", "/auth/verification-otp", {
      error: Schema.Union([
        BadRequestError,
        NotFoundError,
        InternalServerError,
      ]),
      success: VerificationOTPResponseSchema,
    })
      .annotate(OpenApi.Title, "Get Verification OTP")
      .annotate(
        OpenApi.Description,
        "Returns verification OTP state from cookie"
      )
      .annotate(OpenApi.Summary, "Get verification OTP")
  )
  .add(
    HttpApiEndpoint.delete("deleteVerificationOtp", "/auth/verification-otp", {
      payload: VerificationOTPStateSchema,
      error: InternalServerError,
      success: VerificationOTPSuccessSchema,
    })
      .annotate(OpenApi.Title, "Delete Verification OTP")
      .annotate(OpenApi.Description, "Clears verification OTP cookie state")
      .annotate(OpenApi.Summary, "Delete Verification OTP")
  );
