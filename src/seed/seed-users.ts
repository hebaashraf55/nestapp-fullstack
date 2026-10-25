import { hashPassword } from '../auth/password';
import { Role } from '../users/role';
import { UsersService } from '../users/users.service';
import { DEMO_CUSTOMER_EMAIL, DEMO_VIEWER_EMAIL, SeedConfig } from './seed-config';

export type SeedOutcome = 'created' | 'already-exists';

export interface SeedResult {
  email: string;
  role: Role;
  outcome: SeedOutcome;
}

export class SeedConflictError extends Error {
  constructor(email: string) {
    super(
      `An account with email ${email} already exists with a different role or demo flag. ` +
        'The seed never promotes or alters an existing account; resolve it manually.',
    );
    this.name = 'SeedConflictError';
  }
}

/**
 * Idempotent: creates missing accounts, leaves existing ones untouched (including passwords), and
 * stops with an error rather than promoting an account somebody else may have registered first.
 */
export async function seedUsers(users: UsersService, config: SeedConfig): Promise<SeedResult[]> {
  const accounts = [
    {
      email: config.adminEmail,
      name: 'Owner',
      password: config.adminPassword,
      role: Role.ADMIN,
      isDemo: false,
    },
    {
      email: DEMO_CUSTOMER_EMAIL,
      name: 'Demo Customer',
      password: config.demoPassword,
      role: Role.CUSTOMER,
      isDemo: true,
    },
    {
      email: DEMO_VIEWER_EMAIL,
      name: 'Demo Viewer',
      password: config.demoPassword,
      role: Role.DEMO_VIEWER,
      isDemo: true,
    },
  ];

  const results: SeedResult[] = [];
  for (const account of accounts) {
    const existing = await users.findByEmail(account.email);
    if (existing) {
      if (existing.role !== account.role || existing.isDemo !== account.isDemo) {
        throw new SeedConflictError(account.email);
      }
      results.push({ email: account.email, role: account.role, outcome: 'already-exists' });
      continue;
    }
    await users.create({
      email: account.email,
      name: account.name,
      passwordHash: await hashPassword(account.password),
      role: account.role,
      isDemo: account.isDemo,
    });
    results.push({ email: account.email, role: account.role, outcome: 'created' });
  }
  return results;
}
