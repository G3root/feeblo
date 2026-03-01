import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "@effect/platform";
import { Schema } from "effect";
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
    HttpApiEndpoint.post("postVerificationOtp", "/auth/verification-otp")
      .setPayload(VerificationOTPStateSchema)
      .addSuccess(VerificationOTPSuccessSchema, { status: 200 })
      .addError(BadRequestError)
      .addError(InternalServerError)
      .annotateContext(
        OpenApi.annotations({
          title: "Create Verification OTP",
          description:
            "Creates verification OTP state and stores it in a cookie",
          summary: "Create verification OTP",
        })
      )
  )
  .add(
    HttpApiEndpoint.get("getVerificationOtp", "/auth/verification-otp")
      .addSuccess(VerificationOTPResponseSchema, { status: 200 })
      .addError(BadRequestError)
      .addError(NotFoundError)
      .addError(InternalServerError)
      .annotateContext(
        OpenApi.annotations({
          title: "Get Verification OTP",
          description: "Returns verification OTP state from cookie",
          summary: "Get verification OTP",
        })
      )
  )
  .add(
    HttpApiEndpoint.del("deleteVerificationOtp", "/auth/verification-otp")
      .addSuccess(VerificationOTPSuccessSchema, { status: 200 })
      .addError(InternalServerError)
      .annotateContext(
        OpenApi.annotations({
          title: "Delete Verification OTP",
          description: "Clears verification OTP cookie state",
          summary: "Delete verification OTP",
        })
      )
  );
