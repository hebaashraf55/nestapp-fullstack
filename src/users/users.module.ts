import { DynamicModule, Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Env } from '../config/env';
import { MongoUsersRepository } from './mongo-users.repository';
import { UnavailableUsersRepository } from './unavailable-users.repository';
import { User, UserSchema } from './user.schema';
import { UsersRepository } from './users.repository';
import { UsersService } from './users.service';

@Global()
@Module({})
export class UsersModule {
  /** Connects to MongoDB only when MONGODB_URI is set; otherwise user storage is explicitly unavailable. */
  static register(env: Env): DynamicModule {
    const connected = env.MONGODB_URI !== undefined;
    return {
      module: UsersModule,
      imports: connected
        ? [
            MongooseModule.forRoot(env.MONGODB_URI as string, {
              serverSelectionTimeoutMS: 5000,
              retryAttempts: 3,
              retryDelay: 2000,
            }),
            MongooseModule.forFeature([{ name: User.name, schema: UserSchema }]),
          ]
        : [],
      providers: [
        {
          provide: UsersRepository,
          useClass: connected ? MongoUsersRepository : UnavailableUsersRepository,
        },
        UsersService,
      ],
      exports: [UsersRepository, UsersService],
    };
  }
}
