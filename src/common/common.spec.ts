import { ArgumentsHost, BadRequestException, HttpException, StreamableFile } from '@nestjs/common';
import { lastValueFrom, of } from 'rxjs';
import { HttpErrorFilter } from './http-error.filter';
import { ResponseEnvelopeInterceptor } from './response-envelope.interceptor';

interface Captured {
  success: boolean;
  error: { statusCode: number; error: string; message: string; details?: unknown };
}

function run(exception: unknown): { status: number; body: Captured } {
  let status = 0;
  let body = {} as Captured;
  const response = {
    status(code: number) {
      status = code;
      return this;
    },
    json(payload: Captured) {
      body = payload;
    },
  };
  const host = {
    switchToHttp: () => ({ getResponse: () => response }),
  } as unknown as ArgumentsHost;
  new HttpErrorFilter().catch(exception, host);
  return { status, body };
}

describe('HttpErrorFilter', () => {
  it('keeps a plain-string HttpException message', () => {
    const { status, body } = run(new HttpException('Teapot', 418));
    expect(status).toBe(418);
    expect(body.error).toMatchObject({ statusCode: 418, error: "I'm a Teapot", message: 'Teapot' });
  });

  it('moves array messages (validation errors) into details', () => {
    const { status, body } = run(new BadRequestException(['email must be an email', 'x is bad']));
    expect(status).toBe(400);
    expect(body.error.message).toBe('Bad Request');
    expect(body.error.details).toEqual(['email must be an email', 'x is bad']);
  });

  it('passes through exposed 4xx errors from Express middleware without echoing their text', () => {
    const { status, body } = run({ status: 415, expose: true, message: 'secret detail' });
    expect(status).toBe(415);
    expect(body.error.message).toBe('Unsupported Media Type');
    expect(JSON.stringify(body)).not.toContain('secret detail');
  });

  it.each([
    ['plain string', new HttpException('secret db host', 500), 500, 'Internal server error'],
    [
      'object with details',
      new HttpException({ message: 'secret', details: { a: 1 } }, 503),
      503,
      'Service Unavailable',
    ],
    ['array message', new HttpException({ message: ['secret'] }, 502), 502, 'Bad Gateway'],
  ])(
    'hides message and details of a developer-thrown 5xx (%s)',
    (_label, error, expectedStatus, expectedMessage) => {
      const { status, body } = run(error);
      expect(status).toBe(expectedStatus);
      expect(body.error.statusCode).toBe(expectedStatus);
      expect(body.error.message).toBe(expectedMessage);
      expect(body.error.details).toBeUndefined();
      expect(JSON.stringify(body)).not.toContain('secret');
    },
  );

  it.each([
    ['5xx from middleware', { status: 502, expose: true }],
    ['4xx that is not exposed', { status: 400, expose: false }],
    ['a string', 'boom'],
    ['null', null],
    ['an Error', new Error('db password is hunter2')],
  ])('turns %s into a generic 500', (_label, error) => {
    const { status, body } = run(error);
    expect(status).toBe(500);
    expect(body.error.message).toBe('Internal server error');
    expect(JSON.stringify(body)).not.toContain('hunter2');
  });
});

describe('ResponseEnvelopeInterceptor', () => {
  const interceptor = new ResponseEnvelopeInterceptor<unknown>();
  const wrap = (value: unknown) =>
    lastValueFrom(interceptor.intercept({} as never, { handle: () => of(value) }));

  it('wraps values', async () => {
    expect(await wrap({ a: 1 })).toMatchObject({ success: true, data: { a: 1 } });
  });

  it('turns undefined into null so the key is always present', async () => {
    expect(await wrap(undefined)).toMatchObject({ success: true, data: null });
  });

  it('does not wrap file streams', async () => {
    const file = new StreamableFile(Buffer.from('x'));
    expect(await wrap(file)).toBe(file);
  });
});
