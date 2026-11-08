import { AddressesModule } from './addresses/addresses.module';
import { CacheModule } from './cache/cache.module';
import { JobsModule } from './jobs/jobs.module';
import { RealtimeModule } from './realtime/realtime.module';
import { InventoryModule } from './inventory/inventory.module';
import { BundlesModule } from './bundles/bundles.module';
import { NotificationsModule } from './notifications/notifications.module';
import { LooksModule } from './looks/looks.module';
import { MoodboardsModule } from './moodboards/moodboards.module';
import { ReviewsModule } from './reviews/reviews.module';
import { ShopperModule } from './shopper/shopper.module';
import { DynamicModule, Module } from '@nestjs/common';
import { AdminModule } from './admin/admin.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { ENV, Env } from './config/env';
import { CartModule } from './cart/cart.module';
import { OpenApiModule } from './openapi/openapi.module';
import { OrdersModule } from './orders/orders.module';
import { CouponsModule } from './coupons/coupons.module';
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
        CouponsModule.register(env),
        CartModule.register(env),
        OrdersModule.register(env),
        AuditModule.register(env),
        ShopperModule.register(env),
        ReviewsModule.register(env),
        BundlesModule.register(env),
        LooksModule.register(env),
        MoodboardsModule.register(env),
        AddressesModule.register(env),
        NotificationsModule.register(env),
        InventoryModule.register(env),
        CacheModule.register(env),
        JobsModule.register(env),
        RealtimeModule,
        AdminModule.register(),
        OpenApiModule.register(env),
      ],
      controllers: [HealthController],
      providers: [{ provide: ENV, useValue: env }],
    };
  }
}
