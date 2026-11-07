import { NotificationType } from './notification.schema';

export interface NotificationRecord {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  link: string | null;
  readAt: Date | null;
  createdAt: Date;
}
export type NewNotification = Pick<
  NotificationRecord,
  'userId' | 'type' | 'title' | 'body' | 'link'
>;

/** Every read and write is scoped to the owner. */
export abstract class NotificationsRepository {
  abstract create(n: NewNotification): Promise<NotificationRecord>;
  abstract listByUser(userId: string, limit: number): Promise<NotificationRecord[]>;
  abstract countUnread(userId: string): Promise<number>;
  abstract markRead(id: string, userId: string, at: Date): Promise<boolean>;
  abstract markAllRead(userId: string, at: Date): Promise<number>;
}
