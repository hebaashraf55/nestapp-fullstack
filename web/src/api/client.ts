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
