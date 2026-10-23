import { EnvValidationError, loadEnv } from './env';

describe('loadEnv', () => {
  it('applies safe defaults for an empty environment', () => {
    expect(loadEnv({})).toEqual({
      NODE_ENV: 'development',
      PORT: 5000,
      CORS_ORIGINS: [],
      PAYMENTS_MODE: 'simulated',
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
