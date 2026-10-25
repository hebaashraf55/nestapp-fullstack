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

import { getSession, setSession } from '../auth/session';

const BASE = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

interface SendOptions {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
}

let refreshing: Promise<boolean> | null = null;

/** Exchanges the refresh token for new credentials. Single-flight; any failure signs the user out. */
async function refreshSession(): Promise<boolean> {
  refreshing ??= (async () => {
    const session = getSession();
    if (!session) return false;
    try {
      const response = await fetch(`${BASE}/api/auth/refresh`, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: session.refreshToken }),
      });
      const body: unknown = await response.json();
      const creds = isRecord(body) && isRecord(body.data) ? body.data.Credentials : undefined;
      if (
        response.ok &&
        isRecord(creds) &&
        typeof creds.accessToken === 'string' &&
        typeof creds.refreshToken === 'string'
      ) {
        setSession({ ...session, accessToken: creds.accessToken, refreshToken: creds.refreshToken });
        return true;
      }
    } catch {
      /* fall through */
    }
    setSession(null);
    return false;
  })().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

async function send<T>(path: string, options: SendOptions, canRetry = true): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  const session = getSession();
  if (session) headers.Authorization = `Bearer ${session.accessToken}`;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';

  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      method: options.method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError(0, 'Cannot reach the server');
  }

  // An expired access token: refresh once and replay the request (never for the auth routes themselves).
  if (response.status === 401 && session && canRetry && !path.startsWith('/api/auth/')) {
    if (await refreshSession()) return send<T>(path, options, false);
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

export const apiGet = <T>(path: string, signal?: AbortSignal) => send<T>(path, { method: 'GET', signal });
export const apiSend = <T>(method: 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown) =>
  send<T>(path, { method, body });

export interface Health {
  status: 'ok';
  paymentsMode: 'simulated';
}

/** GET /api/health */
export const getHealth = (signal?: AbortSignal) => apiGet<Health>('/api/health', signal);

/* ---------- Catalogue (GET /api/product, /api/category, /api/brand) ---------- */

export interface NamedRef {
  id: string;
  name: string;
  slug: string;
}

export interface Taxonomy extends NamedRef {
  image: string | null;
  isDemo: boolean;
  createdAt: string;
}

export interface Product {
  id: string;
  name: string;
  slug: string;
  description: string;
  images: string[];
  priceCents: number;
  discountPercent: number;
  salePriceCents: number;
  currency: string;
  stock: number;
  inStock: boolean;
  category: NamedRef | null;
  brand: NamedRef | null;
  isDemo: boolean;
  createdAt: string;
}

export interface ProductPage {
  items: Product[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export type ProductSort = 'newest' | 'price-asc' | 'price-desc' | 'name';

export interface ProductQuery {
  q?: string;
  categoryId?: string;
  brandId?: string;
  minPrice?: number; // cents
  maxPrice?: number; // cents
  inStock?: boolean;
  sort?: ProductSort;
  page?: number;
  limit?: number;
}

/** Builds a query string, leaving out unset values so the API only sees what the user chose. */
export function toQueryString(params: ProductQuery): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === '' || value === null) continue;
    search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

const isPage = (value: unknown): value is ProductPage =>
  typeof value === 'object' &&
  value !== null &&
  Array.isArray((value as ProductPage).items) &&
  typeof (value as ProductPage).total === 'number';

/** GET /api/product */
export async function getProducts(query: ProductQuery = {}, signal?: AbortSignal): Promise<ProductPage> {
  const data = await apiGet<unknown>(`/api/product${toQueryString(query)}`, signal);
  if (!isPage(data)) throw new ApiError(200, 'Unexpected response from the server');
  return data;
}

/** GET /api/product/:id */
export const getProduct = (id: string, signal?: AbortSignal) =>
  apiGet<Product>(`/api/product/${encodeURIComponent(id)}`, signal);

/** GET /api/category */
export const getCategories = (signal?: AbortSignal) => apiGet<Taxonomy[]>('/api/category', signal);

/** GET /api/brand */
export const getBrands = (signal?: AbortSignal) => apiGet<Taxonomy[]>('/api/brand', signal);

/* ---------- Authentication (POST /api/auth/login, /logout) ---------- */

export interface LoginResult {
  Credentials: { accessToken: string; refreshToken: string };
  user: import('../auth/session').SessionUser;
}

/** POST /api/auth/login. Failures are always the generic "Invalid email or password". */
export const login = (email: string, password: string) =>
  apiSend<LoginResult>('POST', '/api/auth/login', { email, password });

/** POST /api/auth/logout: ends this one session on the server. */
export const logout = (refreshToken: string) =>
  apiSend<{ loggedOut: true }>('POST', '/api/auth/logout', { refreshToken });

/* ---------- Cart (GET/POST /api/cart, PATCH/DELETE /api/cart/:productId, POST /api/cart/apply-coupon) ---------- */

export type LineStatus = 'ok' | 'out-of-stock' | 'insufficient-stock' | 'unavailable';

export interface CartLine {
  productId: string;
  name: string | null;
  slug: string | null;
  image: string | null;
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number;
  availableStock: number;
  status: LineStatus;
}

export interface Cart {
  items: CartLine[];
  itemCount: number;
  subtotalCents: number;
  coupon: { code: string; discountPercent: number } | null;
  discountCents: number;
  totalCents: number;
  currency: string;
  hasIssues: boolean;
  warnings: string[];
}

const isCart = (value: unknown): value is Cart =>
  isRecord(value) && Array.isArray(value.items) && typeof value.totalCents === 'number';

async function cartCall(promise: Promise<unknown>): Promise<Cart> {
  const data = await promise;
  if (!isCart(data)) throw new ApiError(200, 'Unexpected response from the server');
  return data;
}

/** GET /api/cart */
export const getCart = (signal?: AbortSignal) => cartCall(apiGet<unknown>('/api/cart', signal));
/** POST /api/cart. Only a product id and a quantity are ever sent; the server prices the line. */
export const addToCart = (productId: string, quantity: number) =>
  cartCall(apiSend('POST', '/api/cart', { productId, quantity }));
/** PATCH /api/cart/:productId (quantity 0 removes the line) */
export const updateCartItem = (productId: string, quantity: number) =>
  cartCall(apiSend('PATCH', `/api/cart/${encodeURIComponent(productId)}`, { quantity }));
/** DELETE /api/cart/:productId */
export const removeCartItem = (productId: string) =>
  cartCall(apiSend('DELETE', `/api/cart/${encodeURIComponent(productId)}`));
/** POST /api/cart/apply-coupon */
export const applyCoupon = (code: string) =>
  cartCall(apiSend('POST', '/api/cart/apply-coupon', { code }));
