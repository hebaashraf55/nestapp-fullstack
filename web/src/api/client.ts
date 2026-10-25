/**
 * Typed client for the real backend contract (see src/common in the API):
 *   success: { success: true,  data, timestamp }
 *   failure: { success: false, error: { statusCode, error, message, details? }, timestamp }
 * Only endpoints that exist in the API get a function here.
 */
export interface SuccessEnvelope<T> {
  success: true;
  data: T;
  timestamp: string;
}

export interface ErrorBody {
  statusCode: number;
  error: string;
  message: string;
  details?: unknown;
}

export class ApiError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const BASE = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export async function apiGet<T>(path: string, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, { headers: { Accept: 'application/json' }, signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError(0, 'Cannot reach the server');
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new ApiError(response.status, 'Unexpected response from the server');
  }

  if (isRecord(body) && body.success === true && 'data' in body) return body.data as T;
  if (isRecord(body) && isRecord(body.error)) {
    const { statusCode, message, details } = body.error as Partial<ErrorBody>;
    throw new ApiError(
      typeof statusCode === 'number' ? statusCode : response.status,
      typeof message === 'string' ? message : 'Request failed',
      details,
    );
  }
  throw new ApiError(response.status, 'Unexpected response from the server');
}

export interface Health {
  status: 'ok';
  paymentsMode: 'simulated';
}

/** GET /api/health */
export const getHealth = (signal?: AbortSignal) => apiGet<Health>('/api/health', signal);
