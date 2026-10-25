import { Role } from '../users/role';

/** What the guards attach to the request. Always freshly loaded from the database, never from the token. */
export interface AuthenticatedUser {
  id: string;
  email: string;
  role: Role;
  isDemo: boolean;
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthenticatedUser;
  }
}
