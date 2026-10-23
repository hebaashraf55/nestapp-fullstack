import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Project-level guardrails agreed with the owner: no payment gateway, no card handling, and no
 * secrets committed. These fail loudly if someone later adds one by accident.
 */

const root = join(__dirname, '..');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

describe('project guardrails', () => {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const allDeps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });

  it('declares no payment-gateway dependency', () => {
    const forbidden = /stripe|paypal|braintree|adyen|razorpay|mollie|paymob|fawry|squareup/i;
    expect(allDeps.filter((name) => forbidden.test(name))).toEqual([]);
  });

  it('has no payment-gateway or live-key references in application source', () => {
    const forbidden =
      /api\.stripe\.com|tok_visa|\bsk_(live|test)_|\bpk_(live|test)_|paymentIntents/i;
    const offenders = walk(join(root, 'src'))
      .filter((file) => file.endsWith('.ts') && !file.endsWith('.spec.ts'))
      .filter((file) => forbidden.test(readFileSync(file, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('keeps real env files out of git while committing the template', () => {
    const gitignore = readFileSync(join(root, '.gitignore'), 'utf8').split('\n');
    expect(gitignore).toContain('.env');
    expect(gitignore).toContain('.env.*');
    expect(gitignore).toContain('!.env.example');
  });

  it('.env.example contains only the simulated payments mode and no secrets', () => {
    const template = readFileSync(join(root, '.env.example'), 'utf8');
    expect(template).toMatch(/^PAYMENTS_MODE=simulated$/m);
    // Looks at variable names only, so the explanatory comments may still say "secrets".
    expect(template).not.toMatch(/^[A-Z0-9_]*(STRIPE|SECRET|PASSWORD|TOKEN|API_KEY)[A-Z0-9_]*=/m);
  });
});
