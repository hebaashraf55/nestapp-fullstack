/**
 * Human text for every route, keyed by "METHOD /path". Everything else in the OpenAPI document (paths,
 * methods, access rules, status codes, parameters, request bodies and query strings) is read from the
 * running application, so it cannot drift. A test fails when a route is missing here or listed here
 * but no longer exists.
 */
export interface RouteDoc {
  summary: string;
  /** What the `data` field of a successful response contains (the response shapes are TypeScript-only). */
  returns?: string;
}

export const ROUTE_DOCS: Record<string, RouteDoc> = {
  'GET /api/health': { summary: 'Liveness probe', returns: '{ status, paymentsMode }' },
  'GET /api/openapi.json': {
    summary: 'This API description (disabled in production unless OPENAPI_ENABLED=true)',
  },

  'POST /api/auth/signup': {
    summary: 'Create a CUSTOMER account and email a verification code',
    returns: 'Always 202 with the same body, whether or not the address exists',
  },
  'POST /api/auth/verify-email': { summary: 'Confirm an email address with the 6-digit code' },
  'POST /api/auth/resend-otp': { summary: 'Email a new verification code (generic 202)' },
  'POST /api/auth/login': {
    summary: 'Sign in',
    returns: '{ Credentials: { accessToken, refreshToken }, user }',
  },
  'GET /api/auth/google/nonce': {
    summary:
      'A one-time nonce for Google sign-in, and its signed ticket (503 if Google is not configured)',
    returns: '{ nonce, nonceToken }',
  },
  'POST /api/auth/google': {
    summary:
      'Sign in or up with a Google ID token ({ credential, nonceToken }); customers only, verified email required',
    returns: '{ Credentials: { accessToken, refreshToken }, user }',
  },
  'POST /api/auth/refresh': {
    summary: 'Rotate the refresh token; reuse of an old one revokes the session',
    returns: '{ Credentials }',
  },
  'POST /api/auth/logout': { summary: 'End one session' },
  'POST /api/auth/logout-all': { summary: 'End every session and invalidate all access tokens' },
  'GET /api/auth/profile': { summary: 'The signed-in user (never includes the password hash)' },
  'POST /api/auth/forgot-password': { summary: 'Email a password-reset code (generic 202)' },
  'POST /api/auth/reset-password': { summary: 'Set a new password with the mailed code' },

  'POST /api/brand/create': { summary: 'Create a brand', returns: 'the brand' },
  'GET /api/brand': { summary: 'List brands (demo viewer: synthetic only)', returns: 'brand[]' },
  'GET /api/brand/{id}': { summary: 'Get a brand', returns: 'the brand' },
  'PATCH /api/brand/{id}': { summary: 'Update a brand', returns: 'the brand' },
  'DELETE /api/brand/{id}': { summary: 'Delete a brand that no product uses' },
  'POST /api/category/create': { summary: 'Create a category', returns: 'the category' },
  'GET /api/category': {
    summary: 'List categories (demo viewer: synthetic only)',
    returns: 'category[]',
  },
  'GET /api/category/{id}': { summary: 'Get a category', returns: 'the category' },
  'PATCH /api/category/{id}': { summary: 'Update a category', returns: 'the category' },
  'DELETE /api/category/{id}': { summary: 'Delete a category that no product uses' },
  'POST /api/product/create': {
    summary: 'Create a product; the server computes salePriceCents',
    returns: 'the product',
  },
  'GET /api/product': {
    summary: 'Search, filter, sort and page products (money in integer cents)',
    returns: '{ items, page, limit, total, totalPages }',
  },
  'GET /api/product/{id}': { summary: 'Get a product', returns: 'the product' },
  'PATCH /api/product/{id}': { summary: 'Update a product', returns: 'the product' },
  'PATCH /api/product/{id}/stock': {
    summary: 'Add or remove stock atomically ({ change: ±n }); stock never goes below zero (409)',
    returns: 'the product',
  },
  'DELETE /api/product/{id}': {
    summary: 'Delete a product; refused (409) while an unpaid or paid order still holds its stock',
  },

  'GET /api/catalogue/home': {
    summary:
      'Homepage data: every category with its count and first 8 products, plus featured, new, sale and best-selling rows',
    returns: '{ categories[], featured[], newArrivals[], onSale[], bestSellers[] }',
  },
  'GET /api/product/compare': {
    summary: 'Compare 2–4 products side by side (?ids=a,b,c); missing specifications stay empty',
    returns: 'product[]',
  },
  'GET /api/wishlist': {
    summary: 'The caller’s wishlist (deleted products are left out)',
    returns: '{ productIds, items }',
  },
  'PUT /api/wishlist/{productId}': {
    summary: 'Add a product (idempotent; 100 items max)',
    returns: '{ productIds, items }',
  },
  'DELETE /api/wishlist/{productId}': {
    summary: 'Remove a product',
    returns: '{ productIds, items }',
  },
  'POST /api/wishlist/merge': {
    summary: 'Merge a guest wishlist after sign-in; unknown ids are ignored',
    returns: '{ productIds, items }',
  },
  'GET /api/recently-viewed': {
    summary: 'The caller’s recently viewed products, newest first (20 max)',
    returns: '{ productIds, items }',
  },
  'POST /api/recently-viewed/{productId}': {
    summary: 'Record a product view (moves it to the front)',
    returns: '{ productIds, items }',
  },
  'POST /api/recently-viewed/merge': {
    summary: 'Merge guest browsing history after sign-in (newest first)',
    returns: '{ productIds, items }',
  },
  'GET /api/product/{productId}/reviews': {
    summary:
      'Approved reviews with the rating summary (average, count, stars); includes the caller’s own review in any state',
    returns: '{ summary, items, page, limit, total, totalPages, mine }',
  },
  'POST /api/product/{productId}/reviews': {
    summary:
      'Write a review (customers; one per product; verified purchase is decided by the server; held for moderation)',
    returns: 'your review',
  },
  'PATCH /api/reviews/{id}': {
    summary: 'Edit your review; it goes back to moderation',
    returns: 'your review',
  },
  'DELETE /api/reviews/{id}': {
    summary: 'Delete your review (admins may delete any)',
    returns: '{ deleted: true }',
  },
  'GET /api/reviews/moderation': {
    summary: 'Reviews for moderation, newest first (?status=PENDING|APPROVED|REJECTED)',
    returns: '{ items, page, limit, total, totalPages }',
  },
  'PATCH /api/reviews/{id}/moderation': {
    summary: 'Approve or reject a review, with an optional note to the author (audited)',
    returns: 'the review',
  },
  'POST /api/cart/batch': {
    summary: 'Add several products in one step (a bundle or a look); all or nothing',
    returns: 'the cart',
  },
  'GET /api/bundles': {
    summary:
      'Active bundles shoppers can buy now, priced by the server (?productId=… for one product; admins: ?all=true)',
    returns: 'bundle[]',
  },
  'GET /api/bundles/{slug}': {
    summary: 'One bundle with its items, total, bundle price and savings',
    returns: 'the bundle',
  },
  'POST /api/bundles': {
    summary:
      'Create a bundle of 2–6 products with a 1–50 % discount (applied automatically in the cart)',
    returns: 'the bundle',
  },
  'PATCH /api/bundles/{id}': {
    summary: 'Change a bundle (name, items, discount, active)',
    returns: 'the bundle',
  },
  'DELETE /api/bundles/{id}': {
    summary: 'Delete a bundle',
    returns: '{ deleted: true }',
  },
  'GET /api/looks': {
    summary: 'Shop the Look: active looks with their products (?productId=…; admins: ?all=true)',
    returns: 'look[]',
  },
  'GET /api/looks/{slug}': {
    summary: 'One look with its products and optional photo spots',
    returns: 'the look',
  },
  'POST /api/looks': {
    summary: 'Create a look (photo, 1–8 products, optional x/y spots in %)',
    returns: 'the look',
  },
  'PATCH /api/looks/{id}': {
    summary: 'Change a look',
    returns: 'the look',
  },
  'DELETE /api/looks/{id}': {
    summary: 'Delete a look',
    returns: '{ deleted: true }',
  },
  'GET /api/moodboards': {
    summary: 'The caller’s moodboards',
    returns: 'moodboard[]',
  },
  'POST /api/moodboards': {
    summary: 'Create a moodboard (20 per customer)',
    returns: 'the moodboard',
  },
  'GET /api/moodboards/{id}': {
    summary: 'One of the caller’s moodboards',
    returns: 'the moodboard',
  },
  'PATCH /api/moodboards/{id}': {
    summary: 'Rename a moodboard or change its note',
    returns: 'the moodboard',
  },
  'DELETE /api/moodboards/{id}': {
    summary: 'Delete a moodboard',
    returns: '{ deleted: true }',
  },
  'PUT /api/moodboards/{id}/products/{productId}': {
    summary: 'Pin a product (idempotent; 50 per board)',
    returns: 'the moodboard',
  },
  'DELETE /api/moodboards/{id}/products/{productId}': {
    summary: 'Unpin a product',
    returns: 'the moodboard',
  },
  'POST /api/moodboards/{id}/share': {
    summary: 'Create a new private share link; any older link stops working',
    returns: 'the moodboard with sharePath',
  },
  'DELETE /api/moodboards/{id}/share': {
    summary: 'Stop sharing: the link stops working',
    returns: 'the moodboard',
  },
  'GET /api/moodboards/shared/{token}': {
    summary: 'A shared moodboard, read-only, without any owner details',
    returns: '{ name, note, products, updatedAt }',
  },
  'POST /api/coupon': {
    summary:
      'Create a coupon (code is immutable, 1–90 % off, must expire in the future, active by default)',
    returns: 'the coupon',
  },
  'GET /api/coupon': {
    summary: 'List coupons with status and the number of orders placed with each',
    returns: 'coupon[]',
  },
  'GET /api/coupon/{id}': { summary: 'Get a coupon', returns: 'the coupon' },
  'PATCH /api/coupon/{id}': {
    summary: 'Change a coupon’s discount or expiry, or pause / resume it (active)',
    returns: 'the coupon',
  },
  'DELETE /api/coupon/{id}': {
    summary: 'Delete a coupon (placed orders keep their own copy of the code)',
  },

  'GET /api/cart': {
    summary: 'The caller’s cart, priced by the server on every read',
    returns: 'cart view',
  },
  'POST /api/cart': { summary: 'Add a product (stock is checked)', returns: 'cart view' },
  'POST /api/cart/apply-coupon': {
    summary: 'Apply a coupon (10 wrong guesses per 15 minutes, then 429)',
    returns: 'cart view',
  },
  'PATCH /api/cart/{productId}': {
    summary: 'Set a line’s quantity (0 removes it)',
    returns: 'cart view',
  },
  'DELETE /api/cart/{productId}': { summary: 'Remove a line', returns: 'cart view' },

  'POST /api/order': {
    summary:
      'Place an order from the caller’s cart; reserves stock for 30 minutes. SIMULATED: no payment is taken',
    returns: 'order (always includes payment.mode = SIMULATED)',
  },
  'GET /api/order': { summary: 'The caller’s orders, newest first (max 50)', returns: 'order[]' },
  'GET /api/order/{orderId}': {
    summary: 'One order (owner or admin; anyone else gets 404)',
    returns: 'order',
  },
  'POST /api/order/{orderId}/simulate-payment': {
    summary: 'Mark the caller’s order paid. SIMULATED: no payment is taken. Repeating it is a 409',
    returns: 'order',
  },
  'PATCH /api/order/{orderId}/status': {
    summary: 'Admin: cancel before payment, ship, deliver',
    returns: 'order',
  },
  'POST /api/order/{orderId}/refund': {
    summary: 'Admin: SIMULATED refund of a paid, unshipped order; stock is restored',
    returns: 'order',
  },

  'GET /api/admin/stats': {
    summary: 'Dashboard figures (demo viewer: synthetic records only)',
    returns: 'stats',
  },
  'GET /api/admin/customers': {
    summary: 'Customers with masked names and emails (demo viewer: synthetic only)',
    returns: '{ items, page, limit, total, totalPages }',
  },
  'GET /api/admin/orders': {
    summary: 'All orders with a masked customer (demo viewer: synthetic only)',
    returns: '{ items, page, limit, total, totalPages }',
  },
  'GET /api/admin/audit': {
    summary: 'Append-only audit log of admin writes (admin only)',
    returns: '{ items, page, limit, total, totalPages }',
  },
};
