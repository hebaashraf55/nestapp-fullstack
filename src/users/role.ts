export enum Role {
  CUSTOMER = 'CUSTOMER',
  ADMIN = 'ADMIN',
  DEMO_VIEWER = 'DEMO_VIEWER',
}

export const ROLES: readonly Role[] = Object.values(Role);
