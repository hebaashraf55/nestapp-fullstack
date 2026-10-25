import { Injectable } from '@nestjs/common';
import nodemailer, { Transporter } from 'nodemailer';
import { MailMessage, MailSender } from './mail-sender';

@Injectable()
export class SmtpMailSender extends MailSender {
  private readonly transporter: Transporter;

  /** `transport` is injectable so tests can use nodemailer's in-memory JSON transport. */
  constructor(
    smtpUrl: string,
    private readonly from: string,
    transport?: Transporter,
  ) {
    super();
    this.transporter = transport ?? nodemailer.createTransport(smtpUrl);
  }

  async send(message: MailMessage): Promise<void> {
    await this.transporter.sendMail({ from: this.from, ...message });
  }
}
