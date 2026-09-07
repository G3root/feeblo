import { z } from "zod";
import { regexes } from "zod/v4/core";

export const EmailSchema = z
  .email({ error: "Email is required" })
  .min(3, { message: "Email is too short" })
  .max(100, { message: "Email is too long" })
  // users can type the email in any case, but we store it in lowercase
  .transform((value) => value.toLowerCase());

/**
 * Server-acceptability check for on-behalf author/voter emails. Uses Zod
 * core's practical email pattern — the same pattern `z.email()` (and the
 * server's `AuthorEmail` filter via `isValidOnBehalfAuthorEmail` in
 * `packages/domain/src/post/schema.ts`) validates against — so the picker
 * never offers a create-new path the RPC would reject. One shared pattern
 * by construction; no hand-rolled regex to keep in sync.
 */
export const isDeliverableAuthorEmail = (value: string): boolean =>
  regexes.email.test(value);

export const PasswordSchema = z
  .string({ error: "Password is required" })
  .regex(/.*[A-Z].*/, { message: "One uppercase character" })
  .regex(/.*[a-z].*/, { message: "One lowercase character" })
  .regex(/.*\d.*/, { message: "One number" })
  .regex(/.*[`~<>?,./!@#$%^&*()\-_+="'|{}[\];:\\].*/, {
    message: "One special character is required",
  })
  .min(8, { message: "Password is too short" })
  .max(100, { message: "Password is too long" });

export const NameSchema = z
  .string({ error: "Name is required" })
  .min(3, { message: "Name is too short" })
  .max(40, { message: "Name is too long" });

export const PasswordAndConfirmPasswordSchema = z
  .object({ password: PasswordSchema, confirmPassword: PasswordSchema })
  .superRefine(({ confirmPassword, password }, ctx) => {
    if (confirmPassword !== password) {
      ctx.addIssue({
        path: ["confirmPassword"],
        code: "custom",
        message: "The passwords must match",
      });
    }
  });
