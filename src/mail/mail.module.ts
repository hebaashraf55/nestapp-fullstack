import { DynamicModule, Global, Module } from '@nestjs/common';
import { Env } from '../config/env';
import { ConsoleMailSender } from './console-mail-sender';
import { MailSender } from './mail-sender';
import { SmtpMailSender } from './smtp-mail-sender';

@Global()
@Module({})
export class MailModule {
  static register(env: Env): DynamicModule {
    return {
      module: MailModule,
      providers: [
        {
          provide: MailSender,
          useFactory: (): MailSender =>
            env.MAIL_TRANSPORT === 'smtp'
              ? new SmtpMailSender(env.SMTP_URL as string, env.MAIL_FROM as string)
              : new ConsoleMailSender(),
        },
      ],
      exports: [MailSender],
    };
  }
}
