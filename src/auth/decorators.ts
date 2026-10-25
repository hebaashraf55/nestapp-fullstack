import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Request } from 'express';
import { Role } from '../users/role';
import { AuthenticatedUser } from './auth.types';

export const IS_PUBLIC = 'auth:isPublic';
export const ROLES_KEY = 'auth:roles';

/** Opts a route out of the global AuthGuard. Every other route requires a valid token. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Restricts a route (or controller) to the listed roles. Enforced by the global RolesGuard. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser | undefined =>
    context.switchToHttp().getRequest<Request>().user,
);
