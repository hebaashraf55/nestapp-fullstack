import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiGet, getHealth } from '../src/api/client';

function mockFetch(impl: () => Promise<Response>) {
  vi.stubGlobal('fetch', vi.fn(impl));
}
const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

afterEach(() => vi.unstubAllGlobals());

describe('api client', () => {
  it('unwraps the success envelope', async () => {
    mockFetch(() =>
      json({ success: true, data: { status: 'ok', paymentsMode: 'simulated' }, timestamp: 't' }),
    );
    await expect(getHealth()).resolves.toEqual({ status: 'ok', paymentsMode: 'simulated' });
    expect(fetch).toHaveBeenCalledWith('/api/health', expect.objectContaining({ headers: { Accept: 'application/json' } }));
  });

  it('turns the error envelope into an ApiError with status, message and details', async () => {
    mockFetch(() =>
      json(
        { success: false, error: { statusCode: 400, error: 'Bad Request', message: 'Bad Request', details: ['x'] }, timestamp: 't' },
        400,
      ),
    );
    const error = await apiGet('/api/x').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ statusCode: 400, message: 'Bad Request', details: ['x'] });
  });

  it('reports an unreachable server', async () => {
    mockFetch(() => Promise.reject(new TypeError('failed')));
    await expect(apiGet('/api/x')).rejects.toMatchObject({ statusCode: 0, message: 'Cannot reach the server' });
  });

  it('rejects a non-JSON response without leaking its body', async () => {
    mockFetch(() => Promise.resolve(new Response('<html>secret stack</html>', { status: 502 })));
    const error = await apiGet('/api/x').catch((e: unknown) => e as ApiError);
    expect(error).toMatchObject({ statusCode: 502, message: 'Unexpected response from the server' });
    expect(String((error as ApiError).message)).not.toContain('secret');
  });

  it('rejects JSON that is not in the envelope shape', async () => {
    mockFetch(() => json({ hello: 'world' }));
    await expect(apiGet('/api/x')).rejects.toMatchObject({ message: 'Unexpected response from the server' });
  });

  it('re-throws aborts untouched', async () => {
    mockFetch(() => Promise.reject(new DOMException('aborted', 'AbortError')));
    await expect(apiGet('/api/x')).rejects.toMatchObject({ name: 'AbortError' });
  });
});
