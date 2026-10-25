import { z } from 'zod';
import { PLACEHOLDER_MARKER } from '../config/env';

export const DEMO_CUSTOMER_EMAIL = 'demo-customer@example.com';
export const DEMO_VIEWER_EMAIL = 'demo-viewer@example.com';

const password = z.string().min(12, { error: 'must be at least 12 characters' });

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  SEED_ADMIN_EMAIL: z.email({ error: 'must be a valid email address' }),
  SEED_ADMIN_PASSWORD: password,
  SEED_DEMO_PASSWORD: password,
});

export interface SeedConfig {
  adminEmail: string;
  adminPassword: string;
  demoPassword: string;
}

export class SeedConfigError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Invalid seed configuration:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    this.name = 'SeedConfigError';
  }
}

/**
 * Credentials come only from the environment. Messages name the variable, never its value.
 * In production the example placeholders are refused so they cannot become real passwords.
 */
export function loadSeedConfig(source: NodeJS.ProcessEnv = process.env): SeedConfig {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    throw new SeedConfigError(
      parsed.error.issues.map((i) => `${i.path.map(String).join('.')}: ${i.message}`),
    );
  }
  const env = parsed.data;
  const problems: string[] = [];
  const email = env.SEED_ADMIN_EMAIL.trim().toLowerCase();
  if (email === DEMO_CUSTOMER_EMAIL || email === DEMO_VIEWER_EMAIL) {
    problems.push('SEED_ADMIN_EMAIL: must not be one of the demo account addresses');
  }
  if (env.NODE_ENV === 'production') {
    for (const key of ['SEED_ADMIN_PASSWORD', 'SEED_DEMO_PASSWORD'] as const) {
      if (env[key].toLowerCase().includes(PLACEHOLDER_MARKER)) {
        problems.push(`${key}: still contains the example placeholder`);
      }
    }
    if (env.SEED_ADMIN_PASSWORD === env.SEED_DEMO_PASSWORD) {
      problems.push('SEED_ADMIN_PASSWORD: must differ from SEED_DEMO_PASSWORD in production');
    }
  }
  if (problems.length > 0) throw new SeedConfigError(problems);
  return {
    adminEmail: email,
    adminPassword: env.SEED_ADMIN_PASSWORD,
    demoPassword: env.SEED_DEMO_PASSWORD,
  };
}
