import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Request } from 'express';
import { Role } from '../users/role';
import { AuthenticatedUser } from './auth.types';

export const IS_PUBLIC = 'auth:isPublic';
export const ROLES_KEY = 'auth:roles';
export const OPTIONAL_AUTH = 'auth:optional';

/** Opts a route out of the global AuthGuard. Every other route requires a valid token. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/**
 * For public GET routes whose output depends on who is asking (the demo viewer sees only synthetic
 * records). A valid token identifies the caller; a missing or invalid one simply means "anonymous".
 * Use only on safe methods: the demo read-only guard applies to any request that carries an identity.
 */
export const OptionalAuth = () => SetMetadata(OPTIONAL_AUTH, true);

/** Restricts a route (or controller) to the listed roles. Enforced by the global RolesGuard. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser | undefined =>
    context.switchToHttp().getRequest<Request>().user,
);
