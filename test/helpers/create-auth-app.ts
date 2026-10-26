import { AdminModule } from '../../src/admin/admin.module';
import { AuditModule } from '../../src/audit/audit.module';
import { AuditRepository } from '../../src/audit/audit.repository';
import { InMemoryAuditRepository } from './in-memory-audit.repository';
import { INestApplication, Type } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AuthModule } from '../../src/auth/auth.module';
import { OtpRepository } from '../../src/auth/otp.repository';
import { RateLimiter } from '../../src/auth/rate-limiter';
import { RefreshTokenRepository } from '../../src/auth/refresh-token.repository';
import { TokenService } from '../../src/auth/token.service';
import { CatalogueModule } from '../../src/catalogue/catalogue.module';
import {
  BrandsRepository,
  CategoriesRepository,
  ProductsRepository,
} from '../../src/catalogue/catalogue.repositories';
import { CartModule } from '../../src/cart/cart.module';
import { CartsRepository } from '../../src/cart/cart.repository';
import { CouponAttemptLimiter } from '../../src/cart/cart.service';
import { CouponsModule } from '../../src/coupons/coupons.module';
import { CouponsRepository } from '../../src/coupons/coupons.repository';
import { OrdersModule } from '../../src/orders/orders.module';
import { OrdersRepository } from '../../src/orders/orders.repository';
import { OrdersService } from '../../src/orders/orders.service';
import { configureApp } from '../../src/app.setup';
import { ENV, loadEnv } from '../../src/config/env';
import { HealthController } from '../../src/health/health.controller';
import { MailMessage, MailSender } from '../../src/mail/mail-sender';
import { MailModule } from '../../src/mail/mail.module';
import { Role } from '../../src/users/role';
import { UsersModule } from '../../src/users/users.module';
import { UsersRepository } from '../../src/users/users.repository';
import { UsersService } from '../../src/users/users.service';
import {
  InMemoryOtpRepository,
  InMemoryRefreshTokenRepository,
} from './in-memory-auth.repositories';
import {
  InMemoryBrandsRepository,
  InMemoryCategoriesRepository,
  InMemoryProductsRepository,
} from './in-memory-catalogue.repositories';
import { InMemoryCartsRepository, InMemoryCouponsRepository } from './in-memory-cart.repositories';
import { InMemoryOrdersRepository } from './in-memory-orders.repository';
import { InMemoryUsersRepository } from './in-memory-users.repository';

export const TEST_SECRET = 't'.repeat(48);

class CapturingMailSender extends MailSender {
  readonly sent: MailMessage[] = [];
  failWith: Error | null = null;
  async send(message: MailMessage): Promise<void> {
    if (this.failWith) throw this.failWith;
    this.sent.push(message);
  }
  /** The six-digit code from the most recent email to this address. */
  lastCodeFor(email: string): string {
    const mail = [...this.sent].reverse().find((m) => m.to === email);
    const match = mail && /\b(\d{6})\b/.exec(mail.text);
    if (!match?.[1]) throw new Error(`no code mailed to ${email}`);
    return match[1];
  }
}

export interface AuthTestApp {
  app: INestApplication;
  repo: InMemoryUsersRepository;
  otps: InMemoryOtpRepository;
  refreshTokens: InMemoryRefreshTokenRepository;
  brands: InMemoryBrandsRepository;
  categories: InMemoryCategoriesRepository;
  products: InMemoryProductsRepository;
  coupons: InMemoryCouponsRepository;
  carts: InMemoryCartsRepository;
  orders: InMemoryOrdersRepository;
  audit: InMemoryAuditRepository;
  ordersService: OrdersService;
  couponLimiter: CouponAttemptLimiter;
  mail: CapturingMailSender;
  limiter: RateLimiter;
  tokens: TokenService;
  users: UsersService;
  /** Creates a user directly in the fake store and returns a valid bearer token for it. */
  login(role: Role, isDemo?: boolean): Promise<{ id: string; token: string }>;
}

/** The real guards, controllers and `configureApp`, with in-memory stores and a capturing mailer. */
export async function createAuthApp(
  controllers: Type<unknown>[] = [],
  envOverrides: NodeJS.ProcessEnv = { JWT_SECRET: TEST_SECRET },
): Promise<AuthTestApp> {
  const env = loadEnv({ NODE_ENV: 'test', ...envOverrides });
  const repo = new InMemoryUsersRepository();
  const otps = new InMemoryOtpRepository();
  const refreshTokens = new InMemoryRefreshTokenRepository();
  const brands = new InMemoryBrandsRepository();
  const categories = new InMemoryCategoriesRepository();
  const products = new InMemoryProductsRepository();
  const coupons = new InMemoryCouponsRepository();
  const carts = new InMemoryCartsRepository();
  const orders = new InMemoryOrdersRepository();
  const audit = new InMemoryAuditRepository();
  const mail = new CapturingMailSender();
  const moduleRef = await Test.createTestingModule({
    imports: [
      UsersModule.register(env),
      MailModule.register(env),
      AuthModule.register(env),
      CatalogueModule.register(env),
      CouponsModule.register(env),
      CartModule.register(env),
      OrdersModule.register(env),
      AuditModule.register(env),
      AdminModule.register(),
    ],
    controllers: [HealthController, ...controllers],
    providers: [{ provide: ENV, useValue: env }],
  })
    .overrideProvider(UsersRepository)
    .useValue(repo)
    .overrideProvider(OtpRepository)
    .useValue(otps)
    .overrideProvider(RefreshTokenRepository)
    .useValue(refreshTokens)
    .overrideProvider(BrandsRepository)
    .useValue(brands)
    .overrideProvider(CategoriesRepository)
    .useValue(categories)
    .overrideProvider(ProductsRepository)
    .useValue(products)
    .overrideProvider(CouponsRepository)
    .useValue(coupons)
    .overrideProvider(CartsRepository)
    .useValue(carts)
    .overrideProvider(OrdersRepository)
    .useValue(orders)
    .overrideProvider(AuditRepository)
    .useValue(audit)
    .overrideProvider(MailSender)
    .useValue(mail)
    .compile();
  const app = moduleRef.createNestApplication();
  configureApp(app, env);
  await app.init();

  const tokens = moduleRef.get(TokenService);
  const users = moduleRef.get(UsersService);
  const limiter = moduleRef.get(RateLimiter);
  let counter = 0;
  return {
    app,
    repo,
    otps,
    refreshTokens,
    brands,
    categories,
    products,
    coupons,
    carts,
    orders,
    audit,
    ordersService: moduleRef.get(OrdersService),
    couponLimiter: moduleRef.get(CouponAttemptLimiter),
    mail,
    limiter,
    tokens,
    users,
    async login(role, isDemo = role === Role.DEMO_VIEWER) {
      counter += 1;
      const user = await users.create({
        email: `user${counter}@example.com`,
        name: `User ${counter}`,
        passwordHash: 'unused-in-these-tests',
        role,
        isDemo,
        emailVerified: true,
      });
      return { id: user.id, token: tokens.sign(user.id, user.tokenVersion) };
    },
  };
}
