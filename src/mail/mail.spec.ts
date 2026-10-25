import nodemailer from 'nodemailer';
import { loadEnv } from '../config/env';
import { ConsoleMailSender } from './console-mail-sender';
import { MailModule } from './mail.module';
import { SmtpMailSender } from './smtp-mail-sender';

describe('mail senders', () => {
  it('the SMTP sender builds the right message (in-memory transport, no network)', async () => {
    const transport = nodemailer.createTransport({ jsonTransport: true });
    const sender = new SmtpMailSender(
      'smtps://unused',
      'Atelier <no-reply@example.com>',
      transport,
    );
    const spy = jest.spyOn(transport, 'sendMail');
    await sender.send({ to: 'a@example.com', subject: 'Subject', text: 'Body 123456' });
    expect(spy).toHaveBeenCalledWith({
      from: 'Atelier <no-reply@example.com>',
      to: 'a@example.com',
      subject: 'Subject',
      text: 'Body 123456',
    });
  });

  it('the SMTP sender surfaces transport failures to the caller', async () => {
    const transport = nodemailer.createTransport({ jsonTransport: true });
    (transport as unknown as { sendMail: () => Promise<never> }).sendMail = () =>
      Promise.reject(new Error('down'));
    const sender = new SmtpMailSender('smtps://unused', 'a@example.com', transport);
    await expect(sender.send({ to: 'b@example.com', subject: 's', text: 't' })).rejects.toThrow(
      'down',
    );
  });

  it('the console sender resolves and prints the message (development only)', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const stdout = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await expect(
      new ConsoleMailSender().send({ to: 'a@example.com', subject: 's', text: 'code 123456' }),
    ).resolves.toBeUndefined();
    warn.mockRestore();
    stdout.mockRestore();
  });

  it('MailModule picks the transport from the environment', () => {
    const smtp = MailModule.register(
      loadEnv({
        MAIL_TRANSPORT: 'smtp',
        SMTP_URL: 'smtps://u:p@smtp.example.com:465',
        MAIL_FROM: 'a@example.com',
      }),
    );
    const dev = MailModule.register(loadEnv({}));
    const factory = (m: ReturnType<typeof MailModule.register>) =>
      (m.providers?.[0] as { useFactory: () => unknown }).useFactory();
    expect(factory(smtp)).toBeInstanceOf(SmtpMailSender);
    expect(factory(dev)).toBeInstanceOf(ConsoleMailSender);
  });
});
