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

/* ---------- Orders (POST/GET /api/order, GET /api/order/:id, POST /api/order/:id/simulate-payment) ---------- */

export type OrderStatus = 'PENDING_PAYMENT' | 'PAID' | 'SHIPPED' | 'DELIVERED' | 'CANCELLED' | 'EXPIRED';
export type PaymentStatus = 'SIMULATED_UNPAID' | 'SIMULATED_PAID' | 'SIMULATED_REFUNDED';

export interface OrderItem {
  productId: string;
  name: string;
  unitPriceCents: number;
  quantity: number;
  lineTotalCents: number;
}

export interface Order {
  id: string;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  items: OrderItem[];
  subtotalCents: number;
  coupon: { code: string; discountPercent: number } | null;
  discountCents: number;
  totalCents: number;
  currency: string;
  address: string;
  phone: string;
  expiresAt: string;
  paidAt: string | null;
  refundedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  isDemo: boolean;
  payment: { mode: 'SIMULATED'; notice: string };
}

const isOrder = (value: unknown): value is Order =>
  isRecord(value) && typeof value.id === 'string' && typeof value.status === 'string' && Array.isArray(value.items);

async function orderCall(promise: Promise<unknown>): Promise<Order> {
  const data = await promise;
  if (!isOrder(data)) throw new ApiError(200, 'Unexpected response from the server');
  return data;
}

/** POST /api/order: turns the signed-in user's server-priced cart into an order. Only address and phone are sent. */
export const createOrder = (address: string, phone: string) =>
  orderCall(apiSend('POST', '/api/order', { address, phone }));

/** GET /api/order */
export async function getOrders(signal?: AbortSignal): Promise<Order[]> {
  const data = await apiGet<unknown>('/api/order', signal);
  if (!Array.isArray(data) || !data.every(isOrder)) throw new ApiError(200, 'Unexpected response from the server');
  return data;
}

/** GET /api/order/:id */
export const getOrder = async (id: string, signal?: AbortSignal) =>
  orderCall(apiGet<unknown>(`/api/order/${encodeURIComponent(id)}`, signal));

/** POST /api/order/:id/simulate-payment. No body: nothing about a card is ever sent. */
export const simulatePayment = (id: string) =>
  orderCall(apiSend('POST', `/api/order/${encodeURIComponent(id)}/simulate-payment`, {}));

/* ---------- Admin (GET /api/admin/*, PATCH /api/order/:id/status, POST /api/order/:id/refund) ---------- */
/* The server enforces every permission; these calls simply fail with 401/403 for anyone who may not use them. */

export interface AdminStats {
  scope: 'all' | 'demo';
  currency: string;
  customers: number;
  products: { total: number; outOfStock: number; lowStock: number; lowStockThreshold: number };
  orders: { total: number; byStatus: Record<OrderStatus, number> };
  simulatedPaidCents: number;
  simulatedRefundedCents: number;
  notice: string;
}

export interface AdminCustomer {
  id: string;
  displayName: string;
  maskedEmail: string;
  emailVerified: boolean;
  isDemo: boolean;
  createdAt: string;
}

export interface AdminOrder extends Order {
  customer: { id: string; displayName: string; maskedEmail: string };
}

export interface AuditEntry {
  id: string;
  actorId: string;
  actorRole: string;
  action: string;
  targetId: string | null;
  detail: string | null;
  createdAt: string;
}

export interface AdminPage<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

function adminPage<T>(data: unknown, isItem: (v: unknown) => v is T): AdminPage<T> {
  if (
    !isRecord(data) ||
    !Array.isArray(data.items) ||
    !data.items.every(isItem) ||
    typeof data.page !== 'number' ||
    typeof data.total !== 'number' ||
    typeof data.totalPages !== 'number' ||
    typeof data.limit !== 'number'
  ) {
    throw new ApiError(200, 'Unexpected response from the server');
  }
  return data as unknown as AdminPage<T>;
}

const hasString = (v: unknown, key: string): v is Record<string, unknown> =>
  isRecord(v) && typeof v[key] === 'string';
const isCustomer = (v: unknown): v is AdminCustomer => hasString(v, 'maskedEmail');
const isAdminOrder = (v: unknown): v is AdminOrder => isOrder(v) && isRecord((v as unknown as Record<string, unknown>).customer);
const isAuditEntry = (v: unknown): v is AuditEntry => hasString(v, 'action') && hasString(v, 'actorId');

/** GET /api/admin/stats */
export async function getAdminStats(signal?: AbortSignal): Promise<AdminStats> {
  const data = await apiGet<unknown>('/api/admin/stats', signal);
  if (!isRecord(data) || !isRecord(data.orders) || !isRecord(data.products) || typeof data.customers !== 'number') {
    throw new ApiError(200, 'Unexpected response from the server');
  }
  return data as unknown as AdminStats;
}

const pageQuery = (page: number, extra: Record<string, string | undefined> = {}) => {
  const params = new URLSearchParams({ page: String(page), limit: '10' });
  for (const [k, v] of Object.entries(extra)) if (v) params.set(k, v);
  return params.toString();
};

/** GET /api/admin/customers (names and emails arrive already masked) */
export async function getAdminCustomers(page: number, signal?: AbortSignal) {
  return adminPage(await apiGet<unknown>(`/api/admin/customers?${pageQuery(page)}`, signal), isCustomer);
}

/** GET /api/admin/orders */
export async function getAdminOrders(page: number, status: OrderStatus | '', signal?: AbortSignal) {
  return adminPage(
    await apiGet<unknown>(`/api/admin/orders?${pageQuery(page, { status: status || undefined })}`, signal),
    isAdminOrder,
  );
}

/** GET /api/admin/audit (administrators only) */
export async function getAuditLog(page: number, signal?: AbortSignal) {
  return adminPage(await apiGet<unknown>(`/api/admin/audit?${pageQuery(page)}`, signal), isAuditEntry);
}

/** PATCH /api/order/:id/status */
export const setOrderStatus = (id: string, status: 'SHIPPED' | 'DELIVERED' | 'CANCELLED') =>
  orderCall(apiSend('PATCH', `/api/order/${encodeURIComponent(id)}/status`, { status }));

/** POST /api/order/:id/refund. Simulated: no money moves. */
export const refundOrder = (id: string) =>
  orderCall(apiSend('POST', `/api/order/${encodeURIComponent(id)}/refund`, {}));
