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
  /** OAuth 2.0 Web client id from Google Cloud. Unset: "Continue with Google" is switched off. */
  GOOGLE_CLIENT_ID: optionalString(
    z.string().regex(/^[\w-]+\.apps\.googleusercontent\.com$/, {
      error: 'must be a Google OAuth client id ending in .apps.googleusercontent.com',
    }),
  ),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(86_400).default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(7),
  /**
   * How many reverse proxies sit in front of the API. 0 (the default) trusts no forwarding header, so a
   * client cannot choose its own address by sending X-Forwarded-For. Set it to the real hop count (for
   * example 1 behind a single load balancer); `true` or a blanket "trust everyone" is deliberately not allowed.
   */
  TRUST_PROXY: z.coerce.number().int().min(0).max(5).default(0),
  /** Requests allowed per client address per window, across the whole API (`/api/health` excluded). */
  THROTTLE_LIMIT: z.coerce.number().int().min(1).max(100_000).default(300),
  THROTTLE_WINDOW_SECONDS: z.coerce.number().int().min(1).max(3600).default(60),
  /**
   * Serves the machine-readable API description at GET /api/openapi.json. On by default for local work and
   * off by default in production (set it to "true" there only if you want the contract public).
   */
  OPENAPI_ENABLED: z.enum(['true', 'false']).optional(),
  /** console: dev only (prints codes); smtp: real email; disabled: public demo without email. */
  MAIL_TRANSPORT: z.enum(['console', 'smtp', 'disabled']).default('console'),
  SMTP_URL: optionalString(
    z.string().regex(/^smtps?:\/\/\S+$/, { error: 'must be an smtp:// or smtps:// URL' }),
  ),
  MAIL_FROM: optionalString(z.string().min(3).max(200)),
  /** json: one JSON object per log line (default in production); text: readable lines (default otherwise). */
  LOG_FORMAT: z.enum(['json', 'text']).optional(),
  /**
   * Optional shared cache. Unset: an in-memory cache per process. If Redis becomes unreachable the API
   * keeps working on the in-memory cache and logs the switch.
   */
  REDIS_URL: optionalString(
    z.string().regex(/^rediss?:\/\/\S+$/, { error: 'must be a redis:// or rediss:// URL' }),
  ),
  /** Runs the background job worker in this process (on by default; set "off" on extra web instances). */
  JOBS_WORKER: z.enum(['on', 'off']).default('on'),
});

const envSchema = envObject.superRefine((env, ctx) => {
  if (env.MONGODB_URI !== undefined && env.JWT_SECRET === undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['JWT_SECRET'],
      message: 'is required when MONGODB_URI is set',
    });
  }
  if (env.MAIL_TRANSPORT === 'smtp') {
    for (const key of ['SMTP_URL', 'MAIL_FROM'] as const) {
      if (env[key] === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: 'is required when MAIL_TRANSPORT=smtp',
        });
      }
    }
  }
  if (env.NODE_ENV === 'production' && env.MAIL_TRANSPORT === 'console') {
    ctx.addIssue({
      code: 'custom',
      path: ['MAIL_TRANSPORT'],
      message:
        'the console transport prints one-time codes to the log and is not allowed in production',
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

/** The documentation endpoint is on unless production, where it must be switched on explicitly. */
export const openApiEnabled = (env: Pick<Env, 'NODE_ENV' | 'OPENAPI_ENABLED'>): boolean =>
  env.OPENAPI_ENABLED === undefined
    ? env.NODE_ENV !== 'production'
    : env.OPENAPI_ENABLED === 'true';

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
