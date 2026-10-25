import { Injectable, Logger } from '@nestjs/common';
import { MailMessage, MailSender } from './mail-sender';

/**
 * Development transport: prints the email, INCLUDING the one-time code, to the server log so you
 * can sign up locally without an SMTP server. Production refuses to start with this transport.
 */
@Injectable()
export class ConsoleMailSender extends MailSender {
  private readonly logger = new Logger('DevMail');

  async send(message: MailMessage): Promise<void> {
    this.logger.warn(`(dev only) To: ${message.to} | ${message.subject}\n${message.text}`);
  }
}
