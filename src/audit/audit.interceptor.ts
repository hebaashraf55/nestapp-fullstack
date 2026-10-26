import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { tap } from 'rxjs';
import { AUDITED, AuditedMeta } from './audited';
import { AuditService } from './audit.service';

const ID_LIKE = /^[A-Za-z0-9_-]{1,64}$/;

/** Records a successful `@Audited` call: who did what to which record. Request bodies are never stored. */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly audit: AuditService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler) {
    const meta = this.reflector.get<AuditedMeta | undefined>(AUDITED, context.getHandler());
    if (!meta) return next.handle();
    const request = context.switchToHttp().getRequest<Request>();
    return next.handle().pipe(
      tap((result: unknown) => {
        const actor = request.user;
        if (!actor) return; // cannot happen on a guarded route; never record an anonymous actor
        const params = request.params as Record<string, string | undefined>;
        const fromParams = params.orderId ?? params.id;
        // Depending on interceptor order the result may already be wrapped in `{ data }`.
        const payload = result as
          { id?: unknown; data?: { id?: unknown } | null } | null | undefined;
        const fromResult = payload?.data?.id ?? payload?.id;
        const target = fromParams ?? (typeof fromResult === 'string' ? fromResult : null);
        const body = request.body as Record<string, unknown> | undefined;
        const rawDetail = meta.detailField ? body?.[meta.detailField] : undefined;
        void this.audit.record({
          actorId: actor.id,
          actorRole: actor.role,
          action: meta.action,
          targetId: target !== null && ID_LIKE.test(target) ? target : null,
          detail: typeof rawDetail === 'string' ? rawDetail.slice(0, 60) : null,
        });
      }),
    );
  }
}
