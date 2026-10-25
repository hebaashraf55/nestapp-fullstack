export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

/** Outgoing email port. Implementations: console (development only) and SMTP. */
export abstract class MailSender {
  abstract send(message: MailMessage): Promise<void>;
}
