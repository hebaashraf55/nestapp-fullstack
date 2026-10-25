import { z } from 'zod';

/** Injection token for the validated, typed environment. */
export const ENV = Symbol('ENV');

const exactOrigin = z.string().refine(
  (value) => {
    try {
      const url = new URL(value);
      return (url.protocol === 'http:' || url.protocol === 'https:') && url.origin === value;
    } catch {
      return false;
    }
  },
  {
    error:
      'must be an exact origin such as https://example.com (no path, no trailing slash, no wildcard)',
  },
);

/** An empty value in a .env file (`KEY=`) means "not set". */
const optionalString = (schema: z.ZodString) =>
  z.preprocess((value) => (value === '' ? undefined : value), schema.optional());

/** Marker used by `.env.example`; a real deployment must never run with it. */
export const PLACEHOLDER_MARKER = 'change-me';

const envObject = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(5000),
  CORS_ORIGINS: z
    .string()
    .default('')
    .transform((value) =>
      value
        .split(',')
        .map((item) => item.trim())
        .filter((item) => item.length > 0),
    )
    .pipe(z.array(exactOrigin)),
  PAYMENTS_MODE: z
    .literal('simulated', {
      error: 'only "simulated" is supported: this project has no payment gateway',
    })
    .default('simulated'),
  MONGODB_URI: optionalString(
    z.string().regex(/^mongodb(\+srv)?:\/\/\S+$/, {
      error: 'must be a mongodb:// or mongodb+srv:// connection string',
    }),
  ),
  JWT_SECRET: optionalString(z.string().min(32, { error: 'must be at least 32 characters' })),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(86_400).default(900),
});

const envSchema = envObject.superRefine((env, ctx) => {
  if (env.MONGODB_URI !== undefined && env.JWT_SECRET === undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['JWT_SECRET'],
      message: 'is required when MONGODB_URI is set',
    });
  }
  if (
    env.NODE_ENV === 'production' &&
    env.JWT_SECRET !== undefined &&
    env.JWT_SECRET.toLowerCase().includes(PLACEHOLDER_MARKER)
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['JWT_SECRET'],
      message: 'still contains the example placeholder; generate a real secret',
    });
  }
});

export type Env = z.infer<typeof envSchema>;

export class EnvValidationError extends Error {
  constructor(public readonly issues: ReadonlyArray<{ variable: string; message: string }>) {
    super(
      `Invalid environment configuration:\n${issues
        .map((issue) => `  - ${issue.variable}: ${issue.message}`)
        .join('\n')}`,
    );
    this.name = 'EnvValidationError';
  }
}

/**
 * Validates environment variables. Error messages name the variable and the rule that failed but
 * never echo the supplied value, so a mistyped secret cannot leak into logs.
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    throw new EnvValidationError(
      result.error.issues.map((issue) => ({
        variable: issue.path.map(String).join('.') || '(root)',
        message: issue.message,
      })),
    );
  }
  return result.data;
}
