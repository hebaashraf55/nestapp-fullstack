import { BadRequestException, PipeTransform } from '@nestjs/common';
import { z } from 'zod';

/** Trimmed, lower-cased, length-bounded email. Normalizing here means every lookup uses one form. */
const email = z.string().trim().toLowerCase().pipe(z.email().max(254));

/** 12+ characters (length beats composition rules); 128 max bounds the cost of hashing. */
const newPassword = z.string().min(12).max(128);

/** Login accepts any plausible length so the response never reveals the password policy. */
const loginPassword = z.string().min(1).max(128);

const code = z.string().regex(/^\d{6}$/, { error: 'must be the 6-digit code' });
const refreshToken = z.string().min(20).max(200);

// strictObject: unknown keys (for example `role` or `isDemo`) are rejected, never silently ignored.
export const signupSchema = z.strictObject({
  email,
  password: newPassword,
  name: z.string().trim().min(1).max(100),
});
export const verifyEmailSchema = z.strictObject({ email, code });
export const emailOnlySchema = z.strictObject({ email });
export const loginSchema = z.strictObject({ email, password: loginPassword });
export const refreshSchema = z.strictObject({ refreshToken });
export const resetPasswordSchema = z.strictObject({ email, code, newPassword });

export type SignupDto = z.infer<typeof signupSchema>;
export type VerifyEmailDto = z.infer<typeof verifyEmailSchema>;
export type EmailOnlyDto = z.infer<typeof emailOnlySchema>;
export type LoginDto = z.infer<typeof loginSchema>;
export type RefreshDto = z.infer<typeof refreshSchema>;
export type ResetPasswordDto = z.infer<typeof resetPasswordSchema>;

/** Validates and normalizes a request body. Error details name the field, never echo its value. */
export class ZodBodyPipe<T extends z.ZodType> implements PipeTransform<unknown, z.infer<T>> {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.infer<T> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException(
        result.error.issues.map((issue) => ({
          field: issue.path.map(String).join('.') || '(body)',
          message: issue.message,
        })),
      );
    }
    return result.data;
  }
}
