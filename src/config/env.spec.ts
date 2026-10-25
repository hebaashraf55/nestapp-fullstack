import { EnvValidationError, loadEnv } from './env';

describe('loadEnv', () => {
  it('applies safe defaults for an empty environment', () => {
    expect(loadEnv({})).toEqual({
      NODE_ENV: 'development',
      PORT: 5000,
      CORS_ORIGINS: [],
      PAYMENTS_MODE: 'simulated',
      ACCESS_TOKEN_TTL_SECONDS: 900,
      REFRESH_TOKEN_TTL_DAYS: 7,
      MAIL_TRANSPORT: 'console',
    });
  });

  it('coerces PORT from a string', () => {
    expect(loadEnv({ PORT: '8080' }).PORT).toBe(8080);
  });

  it.each(['0', '65536', 'abc', '-1', '1.5', ''])('rejects invalid PORT %p', (port) => {
    expect(() => loadEnv({ PORT: port })).toThrow(EnvValidationError);
  });

  it('rejects an unknown NODE_ENV', () => {
    expect(() => loadEnv({ NODE_ENV: 'staging' })).toThrow(/NODE_ENV/);
  });

  it('parses a comma-separated CORS allow-list and trims whitespace', () => {
    const env = loadEnv({ CORS_ORIGINS: ' http://localhost:5173 , https://shop.example.com ,, ' });
    expect(env.CORS_ORIGINS).toEqual(['http://localhost:5173', 'https://shop.example.com']);
  });

  it.each([
    '*',
    'https://shop.example.com/',
    'https://shop.example.com/path',
    'ftp://example.com',
    'not a url',
    'shop.example.com',
  ])('rejects CORS origin %p', (origin) => {
    expect(() => loadEnv({ CORS_ORIGINS: origin })).toThrow(/CORS_ORIGINS/);
  });

  it.each(['stripe', 'live', 'card', ''])('refuses PAYMENTS_MODE=%p', (mode) => {
    expect(() => loadEnv({ PAYMENTS_MODE: mode })).toThrow(/PAYMENTS_MODE/);
  });

  it('accepts PAYMENTS_MODE=simulated', () => {
    expect(loadEnv({ PAYMENTS_MODE: 'simulated' }).PAYMENTS_MODE).toBe('simulated');
  });

  it('reports every problem at once and never echoes supplied values', () => {
    const secretLooking = 'hunter2-super-secret';
    try {
      loadEnv({ PORT: secretLooking, PAYMENTS_MODE: secretLooking, NODE_ENV: secretLooking });
      throw new Error('expected loadEnv to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(EnvValidationError);
      const message = (error as Error).message;
      expect(message).toContain('PORT');
      expect(message).toContain('PAYMENTS_MODE');
      expect(message).toContain('NODE_ENV');
      expect(message).not.toContain(secretLooking);
    }
  });
});

describe('loadEnv: database and auth settings', () => {
  const secret = 'x'.repeat(32);
  const uri = 'mongodb://127.0.0.1:27017/test';

  it('leaves the database unconfigured by default', () => {
    const env = loadEnv({});
    expect(env.MONGODB_URI).toBeUndefined();
    expect(env.JWT_SECRET).toBeUndefined();
  });

  it('treats empty values from a .env file as unset', () => {
    const env = loadEnv({ MONGODB_URI: '', JWT_SECRET: '' });
    expect(env.MONGODB_URI).toBeUndefined();
    expect(env.JWT_SECRET).toBeUndefined();
  });

  it('accepts mongodb and mongodb+srv URIs with a long secret', () => {
    expect(loadEnv({ MONGODB_URI: uri, JWT_SECRET: secret }).MONGODB_URI).toBe(uri);
    expect(
      loadEnv({ MONGODB_URI: 'mongodb+srv://u:p@cluster.example.net/db', JWT_SECRET: secret })
        .MONGODB_URI,
    ).toContain('mongodb+srv://');
  });

  it('requires JWT_SECRET whenever MONGODB_URI is set', () => {
    expect(() => loadEnv({ MONGODB_URI: uri })).toThrow(/JWT_SECRET: is required/);
  });

  it('rejects a short secret and a non-mongo URI without echoing the values', () => {
    const attempt = () =>
      loadEnv({ MONGODB_URI: 'http://evil.example/db', JWT_SECRET: 'short-xyz' });
    expect(attempt).toThrow(EnvValidationError);
    try {
      attempt();
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toMatch(/MONGODB_URI/);
      expect(message).toMatch(/JWT_SECRET/);
      expect(message).not.toContain('short-xyz');
      expect(message).not.toContain('evil.example');
    }
  });

  it('refuses the example placeholder secret in production only', () => {
    const placeholder = 'change-me-'.repeat(4);
    expect(() =>
      loadEnv({ NODE_ENV: 'production', MONGODB_URI: uri, JWT_SECRET: placeholder }),
    ).toThrow(/placeholder/);
    expect(
      loadEnv({ NODE_ENV: 'development', MONGODB_URI: uri, JWT_SECRET: placeholder }),
    ).toBeDefined();
  });

  it('bounds the token lifetime', () => {
    expect(loadEnv({ ACCESS_TOKEN_TTL_SECONDS: '600' }).ACCESS_TOKEN_TTL_SECONDS).toBe(600);
    expect(() => loadEnv({ ACCESS_TOKEN_TTL_SECONDS: '5' })).toThrow(EnvValidationError);
    expect(() => loadEnv({ ACCESS_TOKEN_TTL_SECONDS: '999999' })).toThrow(EnvValidationError);
  });
});

describe('loadEnv: mail and refresh settings', () => {
  const smtp = {
    MAIL_TRANSPORT: 'smtp',
    SMTP_URL: 'smtps://user:pw@smtp.example.com:465',
    MAIL_FROM: 'Atelier <no-reply@example.com>',
  };

  it('accepts a complete SMTP configuration', () => {
    expect(loadEnv(smtp).MAIL_TRANSPORT).toBe('smtp');
  });

  it('requires SMTP_URL and MAIL_FROM for the smtp transport', () => {
    expect(() => loadEnv({ MAIL_TRANSPORT: 'smtp' })).toThrow(/SMTP_URL: is required/);
    expect(() => loadEnv({ MAIL_TRANSPORT: 'smtp', SMTP_URL: smtp.SMTP_URL })).toThrow(
      /MAIL_FROM: is required/,
    );
  });

  it('rejects a non-smtp URL without echoing it', () => {
    try {
      loadEnv({ ...smtp, SMTP_URL: 'http://leak.example/pw123' });
      throw new Error('should have thrown');
    } catch (error) {
      expect((error as Error).message).toMatch(/SMTP_URL/);
      expect((error as Error).message).not.toContain('pw123');
    }
  });

  it('forbids the console mail transport in production (it logs one-time codes)', () => {
    expect(() => loadEnv({ NODE_ENV: 'production' })).toThrow(/console transport/);
    expect(() => loadEnv({ NODE_ENV: 'production', ...smtp })).not.toThrow();
  });

  it('bounds the refresh token lifetime', () => {
    expect(loadEnv({ REFRESH_TOKEN_TTL_DAYS: '30' }).REFRESH_TOKEN_TTL_DAYS).toBe(30);
    expect(() => loadEnv({ REFRESH_TOKEN_TTL_DAYS: '0' })).toThrow(EnvValidationError);
    expect(() => loadEnv({ REFRESH_TOKEN_TTL_DAYS: '365' })).toThrow(EnvValidationError);
  });
});
