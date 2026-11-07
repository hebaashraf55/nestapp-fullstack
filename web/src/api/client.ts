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
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
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
      describeDetails(details) ?? (typeof message === 'string' ? message : 'Request failed'),
      details,
    );
  }
  throw new ApiError(response.status, 'Unexpected response from the server');
}

/**
 * A validation failure arrives as a generic message ("Bad Request") plus per-field details.
 * Show the details instead, e.g. "Phone: must be a valid phone number", so a form says what to fix.
 */
function describeDetails(details: unknown): string | undefined {
  if (!Array.isArray(details)) return undefined;
  const parts = details.flatMap((d) => {
    if (!isRecord(d) || typeof d.message !== 'string') return [];
    if (typeof d.field !== 'string' || d.field === '') return [d.message];
    const label = d.field.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[._]/g, ' ');
    return [`${label.charAt(0).toUpperCase()}${label.slice(1).toLowerCase()}: ${d.message}`];
  });
  return parts.length > 0 ? parts.join(' · ') : undefined;
}

export const apiGet = <T>(path: string, signal?: AbortSignal) => send<T>(path, { method: 'GET', signal });
export const apiSend = <T>(method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown) =>
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
  /** Material, colour, dimensions, care; any may be missing. */
  specs?: { material?: string; color?: string; dimensions?: string; care?: string };
  featured?: boolean;
  variantGroup?: string | null;
  variantLabel?: string | null;
  /** Product detail only: every option of this product, in label order. */
  variants?: VariantOption[];
  isDemo: boolean;
  createdAt: string;
}
export interface VariantOption {
  id: string;
  label: string;
  salePriceCents: number;
  inStock: boolean;
  image: string | null;
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
  featured?: boolean;
  onSale?: boolean;
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

/** POST /api/auth/signup. Always the same generic answer, whether or not the email is registered. */
export const signup = (name: string, email: string, password: string) =>
  apiSend<{ message: string }>('POST', '/api/auth/signup', { name, email, password });

/** POST /api/auth/verify-email with the 6-digit code from the email. */
export const verifyEmail = (email: string, code: string) =>
  apiSend<{ verified: true }>('POST', '/api/auth/verify-email', { email, code });

/** POST /api/auth/resend-otp (cool-down and rate limits apply on the server). */
export const resendVerification = (email: string) =>
  apiSend<{ message: string }>('POST', '/api/auth/resend-otp', { email });

/** POST /api/auth/forgot-password. Same answer for unknown emails. */
export const forgotPassword = (email: string) =>
  apiSend<{ message: string }>('POST', '/api/auth/forgot-password', { email });

/** POST /api/auth/reset-password. Signs every existing session out on success. */
export const resetPassword = (email: string, code: string, newPassword: string) =>
  apiSend<{ passwordReset: true }>('POST', '/api/auth/reset-password', { email, code, newPassword });

/** GET /api/auth/google/nonce: a one-time nonce for Google and the server's signed ticket for it. */
export const getGoogleNonce = () => apiGet<{ nonce: string; nonceToken: string }>('/api/auth/google/nonce');

/** POST /api/auth/google with Google's ID token. The server verifies it; the browser sends no profile data. */
export const googleSignIn = (credential: string, nonceToken: string) =>
  apiSend<LoginResult>('POST', '/api/auth/google', { credential, nonceToken });

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
  /** Complete bundle sets found by the server; older servers omit these. */
  bundles?: AppliedBundle[];
  bundleSavingsCents?: number;
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
/** POST /api/cart/batch: a bundle or a look in one step (all or nothing). */
export const addManyToCart = (items: { productId: string; quantity: number }[]) =>
  cartCall(apiSend('POST', '/api/cart/batch', { items }));
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
  bundleSavingsCents?: number;
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
  /** Older API versions omit these; the UI treats them as absent. */
  timeline?: OrderEvent[];
  returnRequest?: ReturnRequest | null;
  returnable?: boolean;
  cancellable?: boolean;
  isGuest?: boolean;
  guestEmail?: string | null;
  payment: { mode: 'SIMULATED'; notice: string };
}
export type OrderEventType =
  | 'PLACED'
  | 'PAID'
  | 'SHIPPED'
  | 'DELIVERED'
  | 'CANCELLED'
  | 'EXPIRED'
  | 'REFUNDED'
  | 'RETURN_REQUESTED'
  | 'RETURN_APPROVED'
  | 'RETURN_REJECTED'
  | 'RETURN_RECEIVED';
export interface OrderEvent {
  type: OrderEventType;
  at: string;
  note: string | null;
}
export interface ReturnRequest {
  status: 'REQUESTED' | 'APPROVED' | 'REJECTED' | 'RECEIVED';
  reason: string;
  requestedAt: string;
  decidedAt: string | null;
  note: string | null;
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
/** POST /api/order with one of the customer's saved addresses. */
export const createOrderFromAddress = (addressId: string) => orderCall(apiSend('POST', '/api/order', { addressId }));

export interface CartLineInput {
  productId: string;
  quantity: number;
}
export interface AddAvailableResult {
  cart: Cart;
  added: number;
  skipped: { productId: string; name: string | null; reason: string }[];
}
/** POST /api/cart/quote: the server prices a guest's browser cart; nothing is stored. */
export const quoteCart = (items: CartLineInput[]) => cartCall(apiSend('POST', '/api/cart/quote', { items }));
/** POST /api/cart/merge: after sign-in, adds what is still available from the browser cart. */
export const mergeCart = (items: CartLineInput[]) => apiSend<AddAvailableResult>('POST', '/api/cart/merge', { items });

export interface GuestOrderResult {
  order: Order;
  trackingToken: string;
  /** /track/<id>#<code>: the code is after #, so browsers never send it to a server. */
  trackPath: string;
}
export const placeGuestOrder = (input: { email: string; items: CartLineInput[]; address: string; phone: string }) =>
  apiSend<GuestOrderResult>('POST', '/api/order/guest', input);
export const trackOrder = (orderId: string, token: string) => orderCall(apiSend('POST', '/api/order/track', { orderId, token }));
export const trackPay = (orderId: string, token: string) =>
  orderCall(apiSend('POST', '/api/order/track/simulate-payment', { orderId, token }));
export const trackCancel = (orderId: string, token: string) =>
  orderCall(apiSend('POST', '/api/order/track/cancel', { orderId, token }));

export const cancelOrder = (id: string) => orderCall(apiSend('POST', `/api/order/${encodeURIComponent(id)}/cancel`, {}));
export const requestReturn = (id: string, reason: string) =>
  orderCall(apiSend('POST', `/api/order/${encodeURIComponent(id)}/return`, { reason }));
export const reorder = (id: string) => apiSend<AddAvailableResult>('POST', `/api/order/${encodeURIComponent(id)}/reorder`, {});
export async function getReturns(status: ReturnRequest['status'] | '', signal?: AbortSignal): Promise<Order[]> {
  const data = await apiGet<unknown>(`/api/order/returns${status ? `?status=${status}` : ''}`, signal);
  if (!Array.isArray(data) || !data.every(isOrder)) throw new ApiError(200, 'Unexpected response from the server');
  return data;
}
export const decideReturn = (id: string, decision: 'APPROVED' | 'REJECTED' | 'RECEIVED', note?: string) =>
  orderCall(apiSend('PATCH', `/api/order/${encodeURIComponent(id)}/return`, note ? { decision, note } : { decision }));

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

// ---------------------------------------------------------------------------------------------
// Admin catalogue management (ADMIN only; the API answers 403 to everyone else)
// ---------------------------------------------------------------------------------------------

/** Everything an admin may set on a product. The sale price is always computed by the server. */
export interface ProductInput {
  name: string;
  description: string;
  images: string[];
  priceCents: number;
  discountPercent: number;
  stock: number;
  categoryId: string;
  brandId: string;
  variantGroup?: string | null;
  variantLabel?: string | null;
}

const isProduct = (v: unknown): v is Product => hasString(v, 'id') && hasString(v, 'name') && isRecord(v) && typeof v.stock === 'number';
const productCall = async (call: Promise<unknown>): Promise<Product> => {
  const data = await call;
  if (!isProduct(data)) throw new ApiError(200, 'Unexpected response from the server');
  return data;
};

/** POST /api/product/create */
export const createProduct = (input: ProductInput) => productCall(apiSend('POST', '/api/product/create', input));

/** PATCH /api/product/:id. Send only the fields that changed; the rest are kept. */
export const updateProduct = (id: string, patch: Partial<ProductInput>) =>
  productCall(apiSend('PATCH', `/api/product/${encodeURIComponent(id)}`, patch));

/** PATCH /api/product/:id/stock. A relative change, applied atomically; stock never goes below zero. */
export const adjustProductStock = (id: string, change: number) =>
  productCall(apiSend('PATCH', `/api/product/${encodeURIComponent(id)}/stock`, { change }));

/** DELETE /api/product/:id. Refused (409) while an unpaid or paid order still holds the product. */
export const deleteProduct = (id: string) => apiSend<{ deleted: true }>('DELETE', `/api/product/${encodeURIComponent(id)}`);

export type CouponStatus = 'ACTIVE' | 'INACTIVE' | 'EXPIRED';

export interface Coupon {
  id: string;
  code: string;
  discountType: 'PERCENT';
  discountPercent: number;
  expiresAt: string;
  expired: boolean;
  active: boolean;
  status: CouponStatus;
  ordersPlaced: number;
  isDemo: boolean;
  createdAt: string;
}

export interface CouponInput {
  code: string;
  discountPercent: number;
  expiresAt: string; // ISO date-time
  active: boolean;
}

const isCoupon = (v: unknown): v is Coupon => hasString(v, 'code') && hasString(v, 'status');
const couponCall = async (call: Promise<unknown>): Promise<Coupon> => {
  const data = await call;
  if (!isCoupon(data)) throw new ApiError(200, 'Unexpected response from the server');
  return data;
};

/** GET /api/coupon (administrators only) */
export async function getCoupons(signal?: AbortSignal): Promise<Coupon[]> {
  const data = await apiGet<unknown>('/api/coupon', signal);
  if (!Array.isArray(data) || !data.every(isCoupon)) throw new ApiError(200, 'Unexpected response from the server');
  return data;
}

/** POST /api/coupon */
export const createCoupon = (input: CouponInput) => couponCall(apiSend('POST', '/api/coupon', input));

/** PATCH /api/coupon/:id. The code itself can never change. */
export const updateCoupon = (id: string, patch: Partial<Omit<CouponInput, 'code'>>) =>
  couponCall(apiSend('PATCH', `/api/coupon/${encodeURIComponent(id)}`, patch));

/** DELETE /api/coupon/:id. Placed orders keep their own copy of the code. */
export const deleteCoupon = (id: string) => apiSend<{ deleted: true }>('DELETE', `/api/coupon/${encodeURIComponent(id)}`);

// ---------------------------------------------------------------------------------------------
// Homepage feed, comparison, wishlist and recently viewed
// ---------------------------------------------------------------------------------------------

export interface HomeCategory extends NamedRef {
  count: number;
  products: Product[];
}
export interface HomeFeed {
  categories: HomeCategory[];
  featured: Product[];
  newArrivals: Product[];
  onSale: Product[];
  /** From real paid orders only; empty until something has sold. */
  bestSellers: Product[];
}

/** GET /api/catalogue/home */
export async function getHome(signal?: AbortSignal): Promise<HomeFeed> {
  const data = await apiGet<unknown>('/api/catalogue/home', signal);
  if (!isRecord(data) || !Array.isArray(data.categories)) throw new ApiError(200, 'Unexpected response from the server');
  return data as unknown as HomeFeed;
}

/** GET /api/product/compare?ids=… (2–4 products, in this order) */
export const compareProducts = (ids: string[], signal?: AbortSignal) =>
  apiGet<Product[]>(`/api/product/compare?ids=${ids.map(encodeURIComponent).join(',')}`, signal);

export interface ProductList {
  productIds: string[];
  items: Product[];
}
export const getWishlist = (signal?: AbortSignal) => apiGet<ProductList>('/api/wishlist', signal);
export const addToWishlist = (id: string) => apiSend<ProductList>('PUT', `/api/wishlist/${encodeURIComponent(id)}`);
export const removeFromWishlist = (id: string) => apiSend<ProductList>('DELETE', `/api/wishlist/${encodeURIComponent(id)}`);
export const mergeWishlist = (productIds: string[]) => apiSend<ProductList>('POST', '/api/wishlist/merge', { productIds });
export const getRecentlyViewed = (signal?: AbortSignal) => apiGet<ProductList>('/api/recently-viewed', signal);
export const recordView = (id: string) => apiSend<ProductList>('POST', `/api/recently-viewed/${encodeURIComponent(id)}`);
export const mergeRecentlyViewed = (productIds: string[]) =>
  apiSend<ProductList>('POST', '/api/recently-viewed/merge', { productIds });

// ---------------------------------------------------------------------------------------------
// Reviews
// ---------------------------------------------------------------------------------------------

export interface RatingSummary {
  average: number | null;
  count: number;
  /** Approved reviews per star; index 0 = 1 star. */
  distribution: [number, number, number, number, number];
}
export interface Review {
  id: string;
  authorName: string;
  rating: number;
  title: string;
  body: string;
  verifiedPurchase: boolean;
  createdAt: string;
  updatedAt: string;
}
export type ReviewStatus = 'PENDING' | 'APPROVED' | 'REJECTED';
export interface OwnReview extends Review {
  productId: string;
  status: ReviewStatus;
  moderationNote: string | null;
}
export interface ModerationReview extends OwnReview {
  product: { id: string; name: string } | null;
  moderatedAt: string | null;
}
export type ReviewSort = 'newest' | 'highest' | 'lowest';
export interface ProductReviews {
  summary: RatingSummary;
  items: Review[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  mine: OwnReview | null;
}
export interface ReviewInput {
  rating: number;
  title: string;
  body: string;
}

export async function getProductReviews(productId: string, sort: ReviewSort, page: number, signal?: AbortSignal) {
  const data = await apiGet<unknown>(`/api/product/${encodeURIComponent(productId)}/reviews?sort=${sort}&page=${page}&limit=5`, signal);
  if (!isRecord(data) || !Array.isArray(data.items) || !isRecord(data.summary)) throw new ApiError(200, 'Unexpected response from the server');
  return data as unknown as ProductReviews;
}
export const writeReview = (productId: string, input: ReviewInput) =>
  apiSend<OwnReview>('POST', `/api/product/${encodeURIComponent(productId)}/reviews`, input);
export const editReview = (id: string, input: ReviewInput) => apiSend<OwnReview>('PATCH', `/api/reviews/${encodeURIComponent(id)}`, input);
export const deleteReview = (id: string) => apiSend<{ deleted: true }>('DELETE', `/api/reviews/${encodeURIComponent(id)}`);
export const getModerationQueue = (status: ReviewStatus | '', page: number, signal?: AbortSignal) =>
  apiGet<{ items: ModerationReview[]; page: number; limit: number; total: number; totalPages: number }>(
    `/api/reviews/moderation?page=${page}${status ? `&status=${status}` : ''}`,
    signal,
  );
export const moderateReview = (id: string, status: 'APPROVED' | 'REJECTED', note?: string) =>
  apiSend<OwnReview>('PATCH', `/api/reviews/${encodeURIComponent(id)}/moderation`, note ? { status, note } : { status });

// ---------------------------------------------------------------------------------------------
// Bundles, Shop the Look, moodboards
// ---------------------------------------------------------------------------------------------

export interface AppliedBundle {
  bundleId: string;
  name: string;
  times: number;
  discountPercent: number;
  savingsCents: number;
}
export interface Bundle {
  id: string;
  name: string;
  slug: string;
  description: string;
  image: string | null;
  discountPercent: number;
  active: boolean;
  items: { product: Product | null; quantity: number }[];
  itemsTotalCents: number;
  priceCents: number;
  savingsCents: number;
  available: boolean;
  createdAt: string;
}
export interface BundleInput {
  name: string;
  description: string;
  image: string | null;
  items: { productId: string; quantity: number }[];
  discountPercent: number;
  active: boolean;
}
/** Lists are checked, so a wrong response shape shows an error instead of breaking the page. */
async function listOf<T>(promise: Promise<unknown>): Promise<T[]> {
  const data = await promise;
  if (!Array.isArray(data)) throw new ApiError(200, 'Unexpected response from the server');
  return data as T[];
}
export const getBundles = (query: { productId?: string; all?: boolean } = {}, signal?: AbortSignal) =>
  listOf<Bundle>(
    apiGet<unknown>(
      `/api/bundles${toQueryString({ productId: query.productId, all: query.all ? 'true' : undefined } as ProductQuery)}`,
      signal,
    ),
  );
export const getBundle = (slug: string, signal?: AbortSignal) => apiGet<Bundle>(`/api/bundles/${encodeURIComponent(slug)}`, signal);
export const createBundle = (input: BundleInput) => apiSend<Bundle>('POST', '/api/bundles', input);
export const updateBundle = (id: string, input: Partial<BundleInput>) =>
  apiSend<Bundle>('PATCH', `/api/bundles/${encodeURIComponent(id)}`, input);
export const deleteBundle = (id: string) => apiSend<{ deleted: true }>('DELETE', `/api/bundles/${encodeURIComponent(id)}`);

export interface Look {
  id: string;
  title: string;
  slug: string;
  description: string;
  image: string;
  active: boolean;
  spots: { product: Product; x: number | null; y: number | null }[];
  totalCents: number;
  createdAt: string;
}
export interface LookInput {
  title: string;
  description: string;
  image: string;
  spots: { productId: string; x: number | null; y: number | null }[];
  active: boolean;
}
export const getLooks = (query: { productId?: string; all?: boolean } = {}, signal?: AbortSignal) =>
  listOf<Look>(
    apiGet<unknown>(
      `/api/looks${toQueryString({ productId: query.productId, all: query.all ? 'true' : undefined } as ProductQuery)}`,
      signal,
    ),
  );
export const getLook = (slug: string, signal?: AbortSignal) => apiGet<Look>(`/api/looks/${encodeURIComponent(slug)}`, signal);
export const createLook = (input: LookInput) => apiSend<Look>('POST', '/api/looks', input);
export const updateLook = (id: string, input: Partial<LookInput>) => apiSend<Look>('PATCH', `/api/looks/${encodeURIComponent(id)}`, input);
export const deleteLook = (id: string) => apiSend<{ deleted: true }>('DELETE', `/api/looks/${encodeURIComponent(id)}`);

export interface Moodboard {
  id: string;
  name: string;
  note: string;
  productIds: string[];
  products: Product[];
  sharePath: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface SharedMoodboard {
  name: string;
  note: string;
  products: Product[];
  updatedAt: string;
}
const mb = (id: string) => `/api/moodboards/${encodeURIComponent(id)}`;
export const getMoodboards = (signal?: AbortSignal) => listOf<Moodboard>(apiGet<unknown>('/api/moodboards', signal));
export const getMoodboard = (id: string, signal?: AbortSignal) => apiGet<Moodboard>(mb(id), signal);
export const createMoodboard = (name: string, note = '') => apiSend<Moodboard>('POST', '/api/moodboards', { name, note });
export const updateMoodboard = (id: string, patch: { name?: string; note?: string }) => apiSend<Moodboard>('PATCH', mb(id), patch);
export const deleteMoodboard = (id: string) => apiSend<{ deleted: true }>('DELETE', mb(id));
export const pinToMoodboard = (id: string, productId: string) =>
  apiSend<Moodboard>('PUT', `${mb(id)}/products/${encodeURIComponent(productId)}`);
export const unpinFromMoodboard = (id: string, productId: string) =>
  apiSend<Moodboard>('DELETE', `${mb(id)}/products/${encodeURIComponent(productId)}`);
export const shareMoodboard = (id: string) => apiSend<Moodboard>('POST', `${mb(id)}/share`);
export const unshareMoodboard = (id: string) => apiSend<Moodboard>('DELETE', `${mb(id)}/share`);
export const getSharedMoodboard = (token: string, signal?: AbortSignal) =>
  apiGet<SharedMoodboard>(`/api/moodboards/shared/${encodeURIComponent(token)}`, signal);

// ---------------------------------------------------------------------------------------------
// Address book and notifications
// ---------------------------------------------------------------------------------------------

export interface AddressFields {
  label: string;
  fullName: string;
  line1: string;
  line2: string;
  city: string;
  postalCode: string;
  country: string;
  phone: string;
}
export interface SavedAddress extends AddressFields {
  id: string;
  isDefault: boolean;
  createdAt: string;
}
export const getAddresses = (signal?: AbortSignal) => listOf<SavedAddress>(apiGet<unknown>('/api/addresses', signal));
export const createAddress = (fields: AddressFields & { isDefault?: boolean }) => apiSend<SavedAddress>('POST', '/api/addresses', fields);
export const updateAddress = (id: string, fields: Partial<AddressFields>) =>
  apiSend<SavedAddress>('PATCH', `/api/addresses/${encodeURIComponent(id)}`, fields);
export const setDefaultAddress = (id: string) => apiSend<SavedAddress>('POST', `/api/addresses/${encodeURIComponent(id)}/default`, {});
export const deleteAddress = (id: string) => apiSend<{ deleted: true }>('DELETE', `/api/addresses/${encodeURIComponent(id)}`);
/** Same one-line format the server uses on the order. */
export const formatAddress = (a: AddressFields) =>
  [a.fullName, a.line1, a.line2, `${a.postalCode} ${a.city}`, a.country].filter((x) => x.trim() !== '').join(', ');

export interface AppNotification {
  id: string;
  type: 'order' | 'return' | 'review';
  title: string;
  body: string;
  link: string | null;
  read: boolean;
  createdAt: string;
}
export const getNotifications = (signal?: AbortSignal) =>
  apiGet<{ items: AppNotification[]; unread: number }>('/api/notifications', signal);
export const markNotificationRead = (id: string) =>
  apiSend<{ unread: number }>('POST', `/api/notifications/${encodeURIComponent(id)}/read`, {});
export const markAllNotificationsRead = () => apiSend<{ unread: number }>('POST', '/api/notifications/read-all', {});
