import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { UsersRepository } from './users.repository';

/** Bound when MONGODB_URI is not set: every call fails with a generic 503 instead of pretending to work. */
@Injectable()
export class UnavailableUsersRepository extends UsersRepository {
  private fail(): never {
    throw new ServiceUnavailableException();
  }
  findById(): never {
    return this.fail();
  }
  findByEmail(): never {
    return this.fail();
  }
  create(): never {
    return this.fail();
  }
  findPage(): never {
    return this.fail();
  }
  findByIds(): never {
    return this.fail();
  }
  updateRoleAndDemo(): never {
    return this.fail();
  }
  markEmailVerified(): never {
    return this.fail();
  }
  resetPassword(): never {
    return this.fail();
  }
  bumpTokenVersion(): never {
    return this.fail();
  }
}
