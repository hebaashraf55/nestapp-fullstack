import { Injectable, Logger } from '@nestjs/common';
import { MailMessage, MailSender } from './mail-sender';

/**
 * For a public demo without an email provider. Nothing is sent and nothing secret is logged (no
 * recipient, no code), so sign-up verification and password reset simply cannot complete there.
 */
@Injectable()
export class DisabledMailSender extends MailSender {
  private readonly logger = new Logger('Mail');

  async send(message: MailMessage): Promise<void> {
    this.logger.warn(`Email is disabled (MAIL_TRANSPORT=disabled); not sent: "${message.subject}"`);
  }
}
