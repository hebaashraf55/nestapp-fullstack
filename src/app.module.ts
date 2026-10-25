import { DynamicModule, Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { ENV, Env } from './config/env';
import { CatalogueModule } from './catalogue/catalogue.module';
import { HealthController } from './health/health.controller';
import { MailModule } from './mail/mail.module';
import { UsersModule } from './users/users.module';

@Module({})
export class AppModule {
  /** The environment is validated once at startup and injected, instead of being read ad hoc. */
  static register(env: Env): DynamicModule {
    return {
      module: AppModule,
      imports: [
        UsersModule.register(env),
        MailModule.register(env),
        AuthModule.register(env),
        CatalogueModule.register(env),
      ],
      controllers: [HealthController],
      providers: [{ provide: ENV, useValue: env }],
    };
  }
}
