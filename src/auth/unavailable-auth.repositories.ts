import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { OtpRepository } from './otp.repository';
import { RefreshTokenRepository } from './refresh-token.repository';

const fail = (): never => {
  throw new ServiceUnavailableException();
};

/** Bound when MONGODB_URI is not set: fails with a generic 503 instead of pretending to work. */
@Injectable()
export class UnavailableOtpRepository extends OtpRepository {
  replace = fail;
  find = fail;
  addAttempt = fail;
  consume = fail;
  deleteForUser = fail;
}

@Injectable()
export class UnavailableRefreshTokenRepository extends RefreshTokenRepository {
  create = fail;
  findByHash = fail;
  revoke = fail;
  revokeFamily = fail;
  revokeAllForUser = fail;
}
