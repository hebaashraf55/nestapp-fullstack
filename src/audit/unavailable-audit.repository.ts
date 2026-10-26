import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { AuditRepository } from './audit.repository';

const fail = (): never => {
  throw new ServiceUnavailableException();
};

/** Bound when MONGODB_URI is not set. */
@Injectable()
export class UnavailableAuditRepository extends AuditRepository {
  record = fail;
  findPage = fail;
}
