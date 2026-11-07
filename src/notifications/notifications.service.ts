import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AuthenticatedUser } from '../auth/auth.types';
import { NotificationType } from './notification.schema';
import { NotificationRecord, NotificationsRepository } from './notifications.repository';

const LIST_LIMIT = 50;

export interface NotificationView {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  link: string | null;
  read: boolean;
  createdAt: Date;
}
const view = (n: NotificationRecord): NotificationView => ({
  id: n.id,
  type: n.type,
  title: n.title,
  body: n.body,
  link: n.link,
  read: n.readAt !== null,
  createdAt: n.createdAt,
});

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(private readonly repo: NotificationsRepository) {}

  /**
   * Best effort: a notification that cannot be saved is logged, never allowed to fail the action that
   * caused it (an order is shipped whether or not the bell updates). Guests have no account to notify.
   */
  async notify(
    userId: string,
    n: { type: NotificationType; title: string; body?: string; link?: string | null },
  ): Promise<void> {
    if (!userId || userId.startsWith('guest:')) return;
    try {
      await this.repo.create({
        userId,
        type: n.type,
        title: n.title.slice(0, 120),
        body: (n.body ?? '').slice(0, 500),
        link: n.link && n.link.startsWith('/') && !n.link.startsWith('//') ? n.link : null,
      });
    } catch (error) {
      this.logger.warn(`Could not save a ${n.type} notification: ${String(error)}`);
    }
  }

  async list(user: AuthenticatedUser): Promise<{ items: NotificationView[]; unread: number }> {
    const [items, unread] = await Promise.all([
      this.repo.listByUser(user.id, LIST_LIMIT),
      this.repo.countUnread(user.id),
    ]);
    return { items: items.map(view), unread };
  }

  async markRead(id: string, user: AuthenticatedUser): Promise<{ unread: number }> {
    if (!(await this.repo.markRead(id, user.id, new Date())))
      throw new NotFoundException('Notification not found');
    return { unread: await this.repo.countUnread(user.id) };
  }

  async markAllRead(user: AuthenticatedUser): Promise<{ unread: number }> {
    await this.repo.markAllRead(user.id, new Date());
    return { unread: 0 };
  }
}
