import { hashPassword, verifyPassword } from './password';

describe('password hashing (scrypt)', () => {
  it('verifies the right password and rejects a wrong one', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(await verifyPassword('correct horse battery staple', hash)).toBe(true);
    expect(await verifyPassword('correct horse battery stapl', hash)).toBe(false);
    expect(await verifyPassword('', hash)).toBe(false);
  });

  it('never stores the password and salts every hash', async () => {
    const a = await hashPassword('same-password-12');
    const b = await hashPassword('same-password-12');
    expect(a).not.toContain('same-password-12');
    expect(a).not.toBe(b);
    expect(a).toMatch(/^scrypt\$131072\$8\$1\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
  });

  it.each([
    '',
    'plain-text',
    'scrypt$1$2$3',
    'bcrypt$1$1$1$aa$bb',
    'scrypt$x$8$1$aa$bb',
    'scrypt$16$8$1$zz$',
  ])('returns false (never throws) for malformed stored hash %p', async (stored) => {
    await expect(verifyPassword('anything', stored)).resolves.toBe(false);
  });
});
