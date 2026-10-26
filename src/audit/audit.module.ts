import { DynamicModule, Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { MongooseModule } from '@nestjs/mongoose';
import { Env } from '../config/env';
import { AuditInterceptor } from './audit.interceptor';
import { AuditRepository } from './audit.repository';
import { AuditLog, AuditLogSchema } from './audit.schema';
import { AuditService } from './audit.service';
import { MongoAuditRepository } from './mongo-audit.repository';
import { UnavailableAuditRepository } from './unavailable-audit.repository';

@Global()
@Module({})
export class AuditModule {
  static register(env: Env): DynamicModule {
    const connected = env.MONGODB_URI !== undefined;
    return {
      module: AuditModule,
      imports: connected
        ? [MongooseModule.forFeature([{ name: AuditLog.name, schema: AuditLogSchema }])]
        : [],
      providers: [
        {
          provide: AuditRepository,
          useClass: connected ? MongoAuditRepository : UnavailableAuditRepository,
        },
        AuditService,
        { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
      ],
      exports: [AuditService],
    };
  }
}
