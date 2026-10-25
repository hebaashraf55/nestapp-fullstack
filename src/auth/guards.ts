import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { Role } from '../users/role';
import { UsersService } from '../users/users.service';
import { AuthenticatedUser } from './auth.types';
import { IS_PUBLIC, OPTIONAL_AUTH, ROLES_KEY } from './decorators';
import { TokenService } from './token.service';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function bearerToken(request: Request): string | null {
  const header = request.headers.authorization;
  if (typeof header !== 'string') return null;
  const match = /^Bearer ([A-Za-z0-9._~+/-]+=*)$/i.exec(header.trim());
  return match?.[1] ?? null;
}

/**
 * Global, deny-by-default authentication. Any missing, malformed, expired, tampered or unknown-user
 * credential is a 401 (never a 500). A storage outage is a generic 503, not a misleading 401.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly users: UsersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    const request = context.switchToHttp().getRequest<Request>();
    if (isPublic === true) {
      const optional = this.reflector.getAllAndOverride<boolean | undefined>(OPTIONAL_AUTH, [
        context.getHandler(),
        context.getClass(),
      ]);
      if (optional === true) await this.identifyIfPossible(request);
      return true;
    }
    const token = bearerToken(request);
    const claims = token === null ? null : this.tokens.verify(token);
    if (claims === null) throw new UnauthorizedException();

    return this.authenticate(request, claims);
  }

  /** An invalid or revoked token leaves the request anonymous; storage failures still fail the request. */
  private async identifyIfPossible(request: Request): Promise<void> {
    const token = bearerToken(request);
    const claims = token === null ? null : this.tokens.verify(token);
    if (claims === null) return;
    try {
      await this.authenticate(request, claims);
    } catch (error) {
      // A stale or revoked token means "anonymous". A storage outage is NOT swallowed: failing open
      // there could show a demo viewer data it should not see.
      if (!(error instanceof UnauthorizedException)) throw error;
    }
  }

  private async authenticate(
    request: Request,
    claims: { userId: string; tokenVersion: number },
  ): Promise<true> {
    let user;
    try {
      user = await this.users.findById(claims.userId);
    } catch {
      throw new ServiceUnavailableException();
    }
    // A bumped tokenVersion (password reset, logout-all) revokes every access token issued before it.
    if (!user || user.tokenVersion !== claims.tokenVersion) throw new UnauthorizedException();

    const authenticated: AuthenticatedUser = {
      id: user.id,
      email: user.email,
      role: user.role,
      isDemo: user.isDemo,
    };
    request.user = authenticated;
    return true;
  }
}

/**
 * Applies to every route, so a write route added later is protected without anyone remembering to
 * annotate it: demo-viewer accounts may only use safe (read-only) HTTP methods.
 */
@Injectable()
export class DemoReadOnlyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (
      request.user?.role === Role.DEMO_VIEWER &&
      !SAFE_METHODS.has(request.method.toUpperCase())
    ) {
      throw new ForbiddenException('Demo accounts are read-only');
    }
    return true;
  }
}

/** Enforces `@Roles(...)`. A route with no `@Roles` only needs authentication. */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;
    const user = context.switchToHttp().getRequest<Request>().user;
    // No user here means a @Public route was also given @Roles: a mistake, so deny rather than allow.
    if (!user || !required.includes(user.role)) throw new ForbiddenException();
    return true;
  }
}
