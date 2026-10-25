import { Role } from '../users/role';
import { AuthenticatedUser } from './auth.types';

/**
 * Query filter that every data-reading service must merge into its queries. A demo-viewer can only
 * ever see synthetic records; everyone else is unrestricted by this filter.
 */
export function demoScope(user: AuthenticatedUser): { isDemo?: true } {
  return user.role === Role.DEMO_VIEWER ? { isDemo: true } : {};
}

/** For single-record lookups: may this user see this record? */
export function canSee(user: AuthenticatedUser, record: { isDemo: boolean }): boolean {
  return user.role !== Role.DEMO_VIEWER || record.isDemo;
}
