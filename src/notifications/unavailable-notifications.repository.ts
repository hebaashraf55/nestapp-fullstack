import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { NotificationsRepository } from './notifications.repository';

const fail = (): never => {
  throw new ServiceUnavailableException();
};

/** Bound when MONGODB_URI is not set. */
@Injectable()
export class UnavailableNotificationsRepository extends NotificationsRepository {
  create = fail;
  listByUser = fail;
  countUnread = fail;
  markRead = fail;
  markAllRead = fail;
}
