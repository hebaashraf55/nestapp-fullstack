import { INestApplication, Type } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AuthModule } from '../../src/auth/auth.module';
import { TokenService } from '../../src/auth/token.service';
import { configureApp } from '../../src/app.setup';
import { ENV, loadEnv } from '../../src/config/env';
import { HealthController } from '../../src/health/health.controller';
import { Role } from '../../src/users/role';
import { UsersModule } from '../../src/users/users.module';
import { UsersRepository } from '../../src/users/users.repository';
import { UsersService } from '../../src/users/users.service';
import { InMemoryUsersRepository } from './in-memory-users.repository';

export const TEST_SECRET = 't'.repeat(48);

export interface AuthTestApp {
  app: INestApplication;
  repo: InMemoryUsersRepository;
  tokens: TokenService;
  /** Creates a user directly in the fake store and returns a valid bearer token for it. */
  login(role: Role, isDemo?: boolean): Promise<{ id: string; token: string }>;
}

/** The real guards and `configureApp`, with an in-memory user store and test-only controllers. */
export async function createAuthApp(
  controllers: Type<unknown>[],
  envOverrides: NodeJS.ProcessEnv = { JWT_SECRET: TEST_SECRET },
): Promise<AuthTestApp> {
  const env = loadEnv({ NODE_ENV: 'test', ...envOverrides });
  const repo = new InMemoryUsersRepository();
  const moduleRef = await Test.createTestingModule({
    imports: [UsersModule.register(env), AuthModule.register(env)],
    controllers: [HealthController, ...controllers],
    providers: [{ provide: ENV, useValue: env }],
  })
    .overrideProvider(UsersRepository)
    .useValue(repo)
    .compile();
  const app = moduleRef.createNestApplication();
  configureApp(app, env);
  await app.init();

  const tokens = moduleRef.get(TokenService);
  const users = moduleRef.get(UsersService);
  let counter = 0;
  return {
    app,
    repo,
    tokens,
    async login(role, isDemo = role === Role.DEMO_VIEWER) {
      counter += 1;
      const user = await users.create({
        email: `user${counter}@example.com`,
        name: `User ${counter}`,
        passwordHash: 'unused-in-these-tests',
        role,
        isDemo,
      });
      return { id: user.id, token: tokens.sign(user.id) };
    },
  };
}
