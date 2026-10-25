import { Role } from '../users/role';
import { AuthenticatedUser } from './auth.types';
import { canSee, demoScope } from './demo-scope';

const user = (role: Role, isDemo = false): AuthenticatedUser => ({
  id: '1',
  email: 'e@example.com',
  role,
  isDemo,
});

describe('demo scope', () => {
  it('restricts only the demo viewer to synthetic records', () => {
    expect(demoScope(user(Role.DEMO_VIEWER, true))).toEqual({ isDemo: true });
    expect(demoScope(user(Role.ADMIN))).toEqual({});
    expect(demoScope(user(Role.CUSTOMER))).toEqual({});
  });

  it('canSee hides real records from the demo viewer only', () => {
    expect(canSee(user(Role.DEMO_VIEWER, true), { isDemo: false })).toBe(false);
    expect(canSee(user(Role.DEMO_VIEWER, true), { isDemo: true })).toBe(true);
    expect(canSee(user(Role.CUSTOMER), { isDemo: false })).toBe(true);
    expect(canSee(user(Role.ADMIN), { isDemo: false })).toBe(true);
  });
});
