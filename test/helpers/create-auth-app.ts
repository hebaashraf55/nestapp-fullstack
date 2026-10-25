import { INestApplication, Type } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AuthModule } from '../../src/auth/auth.module';
import { OtpRepository } from '../../src/auth/otp.repository';
import { RateLimiter } from '../../src/auth/rate-limiter';
import { RefreshTokenRepository } from '../../src/auth/refresh-token.repository';
import { TokenService } from '../../src/auth/token.service';
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
  const mail = new CapturingMailSender();
  const moduleRef = await Test.createTestingModule({
    imports: [UsersModule.register(env), MailModule.register(env), AuthModule.register(env)],
    controllers: [HealthController, ...controllers],
    providers: [{ provide: ENV, useValue: env }],
  })
    .overrideProvider(UsersRepository)
    .useValue(repo)
    .overrideProvider(OtpRepository)
    .useValue(otps)
    .overrideProvider(RefreshTokenRepository)
    .useValue(refreshTokens)
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
