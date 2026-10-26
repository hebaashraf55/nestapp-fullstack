import { DynamicModule, Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

/** Depends on global modules only (users, catalogue, audit) plus the orders repository exported below. */
@Module({})
export class AdminModule {
  static register(): DynamicModule {
    return { module: AdminModule, controllers: [AdminController], providers: [AdminService] };
  }
}
