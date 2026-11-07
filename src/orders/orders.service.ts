import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { AddressesService } from '../addresses/addresses.service';
import { formatAddress } from '../addresses/addresses.repository';
import { AuthenticatedUser } from '../auth/auth.types';
import { demoScope } from '../auth/demo-scope';
import { RateLimiter } from '../auth/rate-limiter';
import { TooManyAttemptsException } from '../auth/too-many-attempts.exception';
import { CartService, CartView } from '../cart/cart.service';
import { ProductsRepository } from '../catalogue/catalogue.repositories';
import { ENV, Env } from '../config/env';
import { CouponsRepository } from '../coupons/coupons.repository';
import { InventoryService } from '../inventory/inventory.service';
import { MailSender } from '../mail/mail-sender';
import { NotificationsService } from '../notifications/notifications.service';
import { Role } from '../users/role';
import type {
  CreateOrderDto,
  GuestOrderDto,
  OrderStatusDto,
  ReturnDecisionDto,
  ReturnRequestDto,
  ReturnsQueryDto,
  TrackDto,
} from './dto';
import {
  canAdminTransition,
  MAX_PENDING_ORDERS,
  ORDER_TTL_MS,
  RETURN_WINDOW_MS,
  SIMULATION_NOTICE,
  type OrderEventType,
  type OrderStatus,
  type PaymentStatus,
} from './order-status';
import {
  OrderEvent,
  OrderItemRecord,
  OrderRecord,
  OrdersRepository,
  ReturnRequest,
  Shipment,
} from './orders.repository';

export interface OrderView {
  id: string;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  items: OrderItemRecord[];
  subtotalCents: number;
  bundleSavingsCents: number;
  coupon: { code: string; discountPercent: number } | null;
  discountCents: number;
  totalCents: number;
  currency: string;
  address: string;
  phone: string;
  expiresAt: Date;
  paidAt: Date | null;
  refundedAt: Date | null;
  cancelledAt: Date | null;
  createdAt: Date;
  isDemo: boolean;
  /** Oldest first. */
  timeline: OrderEvent[];
  returnRequest: ReturnRequest | null;
  /** Carrier and tracking number once shipped. Simulated: no real carrier is involved. */
  shipment: Shipment | null;
  /** True while a return may still be requested. */
  returnable: boolean;
  /** True while the customer may still cancel (before shipping). */
  cancellable: boolean;
  isGuest: boolean;
  guestEmail: string | null;
  /** Always present: every order response states that nothing real was charged. */
  payment: { mode: 'SIMULATED'; notice: string };
}

/** Orders placed before timelines existed: rebuilt from the timestamps they do have. */
function legacyTimeline(o: OrderRecord): OrderEvent[] {
  const events: OrderEvent[] = [{ type: 'PLACED', at: o.createdAt, note: null }];
  if (o.paidAt) events.push({ type: 'PAID', at: o.paidAt, note: null });
  if (o.status === 'SHIPPED' || o.status === 'DELIVERED')
    events.push({ type: 'SHIPPED', at: o.paidAt ?? o.createdAt, note: 'Date not recorded' });
  if (o.status === 'DELIVERED')
    events.push({ type: 'DELIVERED', at: o.paidAt ?? o.createdAt, note: 'Date not recorded' });
  if (o.refundedAt) events.push({ type: 'REFUNDED', at: o.refundedAt, note: null });
  else if (o.cancelledAt) events.push({ type: 'CANCELLED', at: o.cancelledAt, note: null });
  if (o.status === 'EXPIRED') events.push({ type: 'EXPIRED', at: o.expiresAt, note: null });
  return events;
}

const deliveredAt = (o: OrderRecord): Date | null =>
  [...o.events].reverse().find((e) => e.type === 'DELIVERED')?.at ?? null;

const makeView =
  (now: () => number) =>
  (o: OrderRecord): OrderView => {
    const delivered = deliveredAt(o);
    return {
      id: o.id,
      status: o.status,
      paymentStatus: o.paymentStatus,
      items: o.items,
      subtotalCents: o.subtotalCents,
      bundleSavingsCents: o.bundleSavingsCents,
      coupon: o.couponCode ? { code: o.couponCode, discountPercent: o.couponPercent ?? 0 } : null,
      discountCents: o.discountCents,
      totalCents: o.totalCents,
      currency: o.currency,
      address: o.address,
      phone: o.phone,
      expiresAt: o.expiresAt,
      paidAt: o.paidAt,
      refundedAt: o.refundedAt,
      cancelledAt: o.cancelledAt,
      createdAt: o.createdAt,
      isDemo: o.isDemo,
      timeline: o.events.length > 0 ? o.events : legacyTimeline(o),
      returnRequest: o.returnRequest,
      shipment: o.shipment,
      returnable:
        o.status === 'DELIVERED' &&
        o.returnRequest === null &&
        o.paymentStatus === 'SIMULATED_PAID' &&
        delivered !== null &&
        now() - delivered.getTime() <= RETURN_WINDOW_MS,
      cancellable: o.status === 'PENDING_PAYMENT' || o.status === 'PAID',
      isGuest: o.guestTokenHash !== null,
      guestEmail: o.guestEmail,
      payment: { mode: 'SIMULATED', notice: SIMULATION_NOTICE },
    };
  };

/** Kept for other modules (admin) that render orders. */
export const toOrderView = makeView(Date.now);

const HISTORY_LIMIT = 50;
const SWEEP_BATCH = 100;
const GUEST_ORDERS_PER_HOUR = 10;
const TRACK_FAILURES = 20;
const hash = (token: string) => createHash('sha256').update(token).digest('hex');
/** Guests are grouped by email (hashed) so the unpaid-order cap applies to them too. */
const guestOwner = (email: string) => `guest:${hash(email.toLowerCase()).slice(0, 32)}`;

const NOTICE: Partial<Record<OrderEventType, string>> = {
  SHIPPED: 'Your order is on its way',
  DELIVERED: 'Your order was delivered',
  CANCELLED: 'Your order was cancelled',
  EXPIRED: 'Your unpaid order expired',
  REFUNDED: 'Your order was refunded (simulated)',
  RETURN_APPROVED: 'Your return was approved',
  RETURN_REJECTED: 'Your return request was declined',
  RETURN_RECEIVED: 'Your return was received and refunded (simulated)',
};

/** Separate counters for guest checkout and tracking-code checks. */
@Injectable()
export class GuestOrderLimiter extends RateLimiter {}

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);
  /** Owners with an order being placed right now (single-instance guard against double submits). */
  private readonly placing = new Set<string>();
  /** Replaceable clock so tests can move time. */
  now: () => number = Date.now;
  private readonly view = makeView(() => this.now());

  constructor(
    private readonly orders: OrdersRepository,
    private readonly products: ProductsRepository,
    private readonly cart: CartService,
    private readonly addresses: AddressesService,
    private readonly notifications: NotificationsService,
    private readonly mail: MailSender,
    private readonly limiter: GuestOrderLimiter,
    @Inject(ENV) private readonly env: Env,
    private readonly inventory: InventoryService,
    private readonly coupons: CouponsRepository,
  ) {}

  private event(type: OrderEventType, note: string | null = null): OrderEvent {
    return { type, at: new Date(this.now()), note };
  }

  private async notify(order: OrderRecord, type: OrderEventType, body = '') {
    const title = NOTICE[type];
    if (!title) return;
    await this.notifications.notify(order.userId, {
      type: type.startsWith('RETURN') ? 'return' : 'order',
      title,
      body: body || `Order …${order.id.slice(-6)}`,
      link: `/orders/${order.id}`,
    });
  }

  // ------------------------------------------------------------------ placing orders

  /** Turns the caller's cart into an order, reserving stock. Prices come from the server-priced cart. */
  async create(user: AuthenticatedUser, dto: CreateOrderDto): Promise<OrderView> {
    let address: string;
    let phone: string;
    if ('addressId' in dto) {
      const saved = await this.addresses.resolve(dto.addressId, user);
      address = formatAddress(saved);
      phone = saved.phone;
    } else {
      address = dto.address;
      phone = dto.phone;
    }
    return this.once(user.id, async () => {
      const cart = await this.cart.get(user.id);
      const order = await this.place(user.id, user.isDemo, cart, address, phone, null);
      try {
        await this.cart.clear(user.id);
      } catch (error) {
        // The order exists and holds its stock; a leftover cart is the lesser problem.
        this.logger.warn(`Could not clear the cart after order ${order.id}: ${String(error)}`);
      }
      return this.view(order);
    });
  }

  /**
   * Guest checkout: the browser cart is priced by the server exactly like an account's cart (coupons
   * need an account). The tracking code is returned once and emailed; only its hash is stored.
   */
  async createGuest(
    dto: GuestOrderDto,
    clientKey: string,
  ): Promise<{ order: OrderView; trackingToken: string; trackPath: string }> {
    const key = `guest-order:${clientKey}`;
    const status = this.limiter.status(key, GUEST_ORDERS_PER_HOUR);
    if (status.blocked) throw new TooManyAttemptsException(status.retryAfterSeconds);
    const owner = guestOwner(dto.email);
    return this.once(owner, async () => {
      const cart = await this.cart.quote(dto.items);
      const token = randomBytes(16).toString('hex');
      const order = await this.place(owner, false, cart, dto.address, dto.phone, {
        email: dto.email,
        tokenHash: hash(token),
      });
      this.limiter.record(key, 60 * 60 * 1000);
      const trackPath = `/track/${order.id}#${token}`;
      await this.sendGuestConfirmation(order, dto.email, trackPath);
      return { order: this.view(order), trackingToken: token, trackPath };
    });
  }

  private async once<T>(owner: string, run: () => Promise<T>): Promise<T> {
    if (this.placing.has(owner)) {
      throw new ConflictException('Another order is already being placed for your account');
    }
    this.placing.add(owner);
    try {
      return await run();
    } finally {
      this.placing.delete(owner);
    }
  }

  private async place(
    owner: string,
    isDemo: boolean,
    cart: CartView,
    address: string,
    phone: string,
    guest: { email: string; tokenHash: string } | null,
  ): Promise<OrderRecord> {
    if (cart.items.length === 0) throw new BadRequestException('Your cart is empty');
    // Never place an order at a different price than the customer expects: a chosen code that can
    // no longer be used (another order just took its last use, it expired…) stops the order.
    if (cart.rejectedCoupon) {
      throw new ConflictException(
        `Coupon ${cart.rejectedCoupon.code} ${cart.rejectedCoupon.reason}. Remove it or review your cart.`,
      );
    }
    if (cart.hasIssues) {
      throw new ConflictException(
        'Some items in your cart are unavailable or out of stock. Please review your cart.',
      );
    }
    // Pay or let old orders lapse first; expired ones free their slot.
    await this.expireOverdueFor(owner);
    if ((await this.orders.countPending(owner)) >= MAX_PENDING_ORDERS) {
      throw new ConflictException(
        `You already have ${MAX_PENDING_ORDERS} unpaid orders. Pay for one or wait for it to expire.`,
      );
    }

    const reserved: { productId: string; quantity: number }[] = [];
    for (const line of cart.items) {
      if (!(await this.products.reserveStock(line.productId, line.quantity))) {
        await this.release(reserved);
        throw new ConflictException(`Not enough stock for "${line.name ?? 'an item'}"`);
      }
      reserved.push({ productId: line.productId, quantity: line.quantity });
    }

    // One use of the promotion, taken atomically; the last use cannot go to two orders.
    let claimedCoupon: string | null = null;
    if (cart.coupon) {
      const promo = await this.coupons.findById(cart.coupon.id);
      const result = promo
        ? await this.coupons.claim(promo.id, owner, promo.maxUsesPerCustomer)
        : 'used-up';
      if (result !== 'ok') {
        await this.release(reserved);
        throw new ConflictException(
          result === 'customer-limit'
            ? `You have already used ${cart.coupon.code} the maximum number of times. Remove it to continue.`
            : `${cart.coupon.code} has just been used up. Please review your cart.`,
        );
      }
      claimedCoupon = cart.coupon.id;
    }

    let created: OrderRecord;
    try {
      created = await this.orders.create({
        userId: owner,
        isDemo,
        items: cart.items.map((l) => ({
          productId: l.productId,
          name: l.name ?? '',
          unitPriceCents: l.unitPriceCents,
          quantity: l.quantity,
          lineTotalCents: l.lineTotalCents,
        })),
        subtotalCents: cart.subtotalCents,
        bundleSavingsCents: cart.bundleSavingsCents,
        couponId: claimedCoupon,
        couponCode: cart.coupon?.code ?? null,
        couponPercent:
          cart.coupon && cart.coupon.type === 'PERCENT' ? cart.coupon.discountPercent : null,
        discountCents: cart.discountCents,
        totalCents: cart.totalCents,
        currency: cart.currency,
        address,
        phone,
        status: 'PENDING_PAYMENT',
        paymentStatus: 'SIMULATED_UNPAID',
        expiresAt: new Date(this.now() + ORDER_TTL_MS),
        paidAt: null,
        refundedAt: null,
        cancelledAt: null,
        guestEmail: guest?.email ?? null,
        guestTokenHash: guest?.tokenHash ?? null,
      });
    } catch (error) {
      await this.release(reserved); // never keep stock for an order that was not saved
      if (claimedCoupon) await this.coupons.release(claimedCoupon, owner).catch(() => undefined);
      throw error;
    }
    await this.inventory.record(
      created.items.map((i) => ({
        productId: i.productId,
        productName: i.name,
        change: -i.quantity,
        reason: 'ORDER_RESERVED' as const,
        orderId: created.id,
        isDemo: created.isDemo,
      })),
    );
    return created;
  }

  private async sendGuestConfirmation(order: OrderRecord, email: string, trackPath: string) {
    if (this.env.MAIL_TRANSPORT === 'disabled') return;
    const origin = this.env.CORS_ORIGINS[0] ?? '';
    try {
      await this.mail.send({
        to: email,
        subject: `NOMA order …${order.id.slice(-6)} (simulated checkout)`,
        text: [
          'Thank you for your order at NOMA, a portfolio demo shop.',
          '',
          `Order: ${order.id}`,
          `Total: ${(order.totalCents / 100).toFixed(2)} ${order.currency}`,
          'Payment: SIMULATED. No payment was taken and no card was charged.',
          '',
          `Track your order: ${origin}${trackPath}`,
          'Keep this link private: anyone with it can see and cancel the order.',
        ].join('\n'),
      });
    } catch (error) {
      this.logger.warn(`Could not send the guest confirmation for ${order.id}: ${String(error)}`);
    }
  }

  // ------------------------------------------------------------------ reading

  async list(user: AuthenticatedUser): Promise<OrderView[]> {
    const found = await this.orders.findByUser(user.id, HISTORY_LIMIT);
    return (await Promise.all(found.map((o) => this.expireIfDue(o)))).map(this.view);
  }

  /** Owners see their own orders and admins any order; everyone else gets 404 (no existence leak). */
  async get(user: AuthenticatedUser, id: string): Promise<OrderView> {
    return this.view(await this.expireIfDue(await this.owned(user, id, true)));
  }

  private async owned(user: AuthenticatedUser, id: string, adminToo = false): Promise<OrderRecord> {
    const order = await this.orders.findById(id);
    if (!order || (order.userId !== user.id && !(adminToo && user.role === Role.ADMIN))) {
      throw new NotFoundException('Order not found');
    }
    return order;
  }

  /** Guest tracking: the order number plus the tracking code. Wrong codes look exactly like unknown orders. */
  private async tracked(dto: TrackDto, clientKey: string): Promise<OrderRecord> {
    const key = `track:${clientKey}`;
    const status = this.limiter.status(key, TRACK_FAILURES);
    if (status.blocked) throw new TooManyAttemptsException(status.retryAfterSeconds);
    const order = await this.orders.findById(dto.orderId);
    const expected = Buffer.from(order?.guestTokenHash ?? hash('no-order'), 'hex');
    const given = Buffer.from(hash(dto.token), 'hex');
    const match = timingSafeEqual(expected, given);
    if (!order || !order.guestTokenHash || !match) {
      this.limiter.record(key, 15 * 60 * 1000);
      throw new NotFoundException('Order not found');
    }
    return this.expireIfDue(order);
  }

  async track(dto: TrackDto, clientKey: string): Promise<OrderView> {
    return this.view(await this.tracked(dto, clientKey));
  }

  async trackPay(dto: TrackDto, clientKey: string): Promise<OrderView> {
    return this.view(await this.pay(await this.tracked(dto, clientKey)));
  }

  async trackCancel(dto: TrackDto, clientKey: string): Promise<OrderView> {
    return this.view(await this.cancel(await this.tracked(dto, clientKey)));
  }

  // ------------------------------------------------------------------ customer actions

  /** Pretend to pay. Only the owner can, only once, and only before the order expires. */
  async simulatePayment(user: AuthenticatedUser, id: string): Promise<OrderView> {
    return this.view(await this.pay(await this.owned(user, id)));
  }

  private async pay(found: OrderRecord): Promise<OrderRecord> {
    const order = await this.expireIfDue(found);
    if (order.status !== 'PENDING_PAYMENT') {
      throw new ConflictException(this.notPayable(order));
    }
    const paid = await this.orders.transition(
      order.id,
      ['PENDING_PAYMENT'],
      { status: 'PAID', paymentStatus: 'SIMULATED_PAID', paidAt: new Date(this.now()) },
      this.event('PAID', 'Simulated payment'),
    );
    if (!paid) {
      // Lost a race with another payment, a cancellation or the expiry sweep.
      const latest = (await this.orders.findById(order.id)) ?? order;
      throw new ConflictException(this.notPayable(latest));
    }
    return paid;
  }

  /** The customer cancels before shipping: unpaid orders are cancelled, paid ones refunded (simulated). */
  async cancelOwn(user: AuthenticatedUser, id: string): Promise<OrderView> {
    return this.view(await this.cancel(await this.owned(user, id)));
  }

  private async cancel(found: OrderRecord): Promise<OrderRecord> {
    const order = await this.expireIfDue(found);
    const at = new Date(this.now());
    let updated: OrderRecord | null = null;
    if (order.status === 'PENDING_PAYMENT') {
      updated = await this.orders.transition(
        order.id,
        ['PENDING_PAYMENT'],
        { status: 'CANCELLED', cancelledAt: at },
        this.event('CANCELLED', 'Cancelled by the customer'),
      );
    } else if (order.status === 'PAID') {
      updated = await this.orders.transition(
        order.id,
        ['PAID'],
        {
          status: 'CANCELLED',
          paymentStatus: 'SIMULATED_REFUNDED',
          cancelledAt: at,
          refundedAt: at,
        },
        this.event('REFUNDED', 'Cancelled by the customer before shipping (simulated refund)'),
      );
    } else {
      throw new ConflictException(
        order.status === 'SHIPPED' || order.status === 'DELIVERED'
          ? 'This order has shipped and can no longer be cancelled. You can request a return after delivery.'
          : `This order is already ${order.status.toLowerCase()}.`,
      );
    }
    if (!updated) throw new ConflictException('The order was changed meanwhile. Please reload.');
    await this.restoreStock(updated);
    return updated;
  }

  async requestReturn(
    user: AuthenticatedUser,
    id: string,
    dto: ReturnRequestDto,
  ): Promise<OrderView> {
    const order = await this.owned(user, id);
    if (!this.view(order).returnable) {
      throw new ConflictException(
        order.returnRequest
          ? 'A return was already requested for this order'
          : order.status !== 'DELIVERED'
            ? 'Returns can be requested once the order is delivered'
            : 'The 30-day return window has closed for this order',
      );
    }
    const at = new Date(this.now());
    const updated = await this.orders.updateReturn(
      order.id,
      null,
      {
        returnRequest: {
          status: 'REQUESTED',
          reason: dto.reason,
          requestedAt: at,
          decidedAt: null,
          note: null,
        },
      },
      this.event('RETURN_REQUESTED', dto.reason),
    );
    if (!updated) throw new ConflictException('A return was already requested for this order');
    return this.view(updated);
  }

  /**
   * Puts what is still available from a past order back in the cart, at today's prices. Nothing is
   * added for products that were removed or sold out; those are listed instead.
   */
  async reorder(user: AuthenticatedUser, id: string) {
    const order = await this.owned(user, id);
    return this.cart.addAvailable(
      user.id,
      order.items.map((i) => ({ productId: i.productId, quantity: i.quantity })),
    );
  }

  // ------------------------------------------------------------------ admin

  /** Admin: fulfilment steps and pre-payment cancellation, validated against the state machine. */
  async setStatus(id: string, dto: OrderStatusDto): Promise<OrderView> {
    const found = await this.orders.findById(id);
    if (!found) throw new NotFoundException('Order not found');
    const order = await this.expireIfDue(found);
    if (!canAdminTransition(order.status, dto.status)) {
      throw new ConflictException(
        `An order that is ${order.status} cannot be set to ${dto.status}`,
      );
    }
    const at = new Date(this.now());
    const shipment: Shipment | null =
      dto.status === 'SHIPPED'
        ? {
            carrier: dto.carrier ?? 'DEMO_POST',
            trackingNumber:
              dto.trackingNumber ?? `SIM-${randomBytes(5).toString('hex').toUpperCase()}`,
            shippedAt: at,
            simulated: true,
          }
        : null;
    const patch =
      dto.status === 'CANCELLED'
        ? { status: dto.status, cancelledAt: at }
        : shipment
          ? { status: dto.status, shipment }
          : { status: dto.status };
    const note = shipment
      ? `${shipment.carrier === 'DEMO_EXPRESS' ? 'Demo Express' : 'Demo Post'} ${shipment.trackingNumber} (simulated carrier)`
      : null;
    const updated = await this.orders.transition(
      order.id,
      [order.status],
      patch,
      this.event(dto.status, note),
    );
    if (!updated)
      throw new ConflictException('The order was changed by someone else. Please reload.');
    if (dto.status === 'CANCELLED') await this.restoreStock(updated);
    await this.notify(updated, dto.status, note ?? '');
    return this.view(updated);
  }

  /** Admin: simulated refund of a paid order that has not shipped. No money moves; stock is restored. */
  async refund(id: string): Promise<OrderView> {
    const found = await this.orders.findById(id);
    if (!found) throw new NotFoundException('Order not found');
    const order = await this.expireIfDue(found);
    if (order.paymentStatus === 'SIMULATED_REFUNDED') {
      throw new ConflictException('This order was already refunded (simulated)');
    }
    if (order.status !== 'PAID') {
      throw new ConflictException(
        order.paymentStatus === 'SIMULATED_PAID'
          ? 'Only paid orders that have not shipped can be refunded'
          : 'This order has not been paid, so there is nothing to refund',
      );
    }
    const at = new Date(this.now());
    const refunded = await this.orders.transition(
      order.id,
      ['PAID'],
      { status: 'CANCELLED', paymentStatus: 'SIMULATED_REFUNDED', refundedAt: at, cancelledAt: at },
      this.event('REFUNDED', 'Simulated refund by the shop'),
    );
    if (!refunded)
      throw new ConflictException('The order was changed by someone else. Please reload.');
    await this.restoreStock(refunded);
    await this.notify(refunded, 'REFUNDED');
    return this.view(refunded);
  }

  async returns(query: ReturnsQueryDto, viewer: AuthenticatedUser): Promise<OrderView[]> {
    const found = await this.orders.findReturns(
      query.status,
      demoScope(viewer).isDemo === true,
      100,
    );
    return found.map(this.view);
  }

  /** Admin: requested → approved or rejected; approved → received (simulated refund, stock restored). */
  async decideReturn(id: string, dto: ReturnDecisionDto): Promise<OrderView> {
    const order = await this.orders.findById(id);
    if (!order) throw new NotFoundException('Order not found');
    const current = order.returnRequest;
    const allowed =
      (current?.status === 'REQUESTED' &&
        (dto.decision === 'APPROVED' || dto.decision === 'REJECTED')) ||
      (current?.status === 'APPROVED' && dto.decision === 'RECEIVED');
    if (!current || !allowed) {
      throw new ConflictException(
        current
          ? `A return that is ${current.status.toLowerCase()} cannot be marked ${dto.decision.toLowerCase()}`
          : 'This order has no return request',
      );
    }
    const at = new Date(this.now());
    const returnRequest = {
      ...current,
      status: dto.decision,
      decidedAt: at,
      note: dto.note ?? current.note,
    };
    const type: OrderEventType = `RETURN_${dto.decision}`;
    const updated = await this.orders.updateReturn(
      order.id,
      current.status,
      dto.decision === 'RECEIVED'
        ? { returnRequest, paymentStatus: 'SIMULATED_REFUNDED', refundedAt: at }
        : { returnRequest },
      this.event(type, dto.note ?? null),
    );
    if (!updated)
      throw new ConflictException('The return was changed by someone else. Please reload.');
    if (dto.decision === 'RECEIVED') await this.restoreStock(updated, 'RETURN_RESTOCK');
    await this.notify(updated, type, dto.note ?? '');
    return this.view(updated);
  }

  /** Expires every overdue unpaid order and gives its stock back. Safe to run on several instances. */
  async expireOverdue(): Promise<number> {
    let expired = 0;
    for (;;) {
      const batch = await this.orders.findOverdue(new Date(this.now()), SWEEP_BATCH);
      if (batch.length === 0) return expired;
      let progressed = false;
      for (const order of batch) {
        const after = await this.expireIfDue(order);
        if (after.status === 'EXPIRED') {
          expired += 1;
          progressed = true;
        }
      }
      if (!progressed || batch.length < SWEEP_BATCH) return expired;
    }
  }

  /** Lazily expires an unpaid order whose hold ran out, restoring its stock. Returns the current state. */
  private async expireIfDue(order: OrderRecord): Promise<OrderRecord> {
    if (order.status !== 'PENDING_PAYMENT' || order.expiresAt.getTime() > this.now()) return order;
    const expired = await this.orders.transition(
      order.id,
      ['PENDING_PAYMENT'],
      { status: 'EXPIRED' },
      this.event('EXPIRED', 'Not paid within 30 minutes; the items were released'),
    );
    if (expired) {
      await this.restoreStock(expired); // only the caller that won the transition restores
      await this.notify(expired, 'EXPIRED');
      return expired;
    }
    return (await this.orders.findById(order.id)) ?? order;
  }

  private async expireOverdueFor(userId: string): Promise<void> {
    for (const order of await this.orders.findByUser(userId, HISTORY_LIMIT)) {
      await this.expireIfDue(order);
    }
  }

  private async restoreStock(
    order: OrderRecord,
    reason: 'ORDER_RELEASED' | 'RETURN_RESTOCK' = 'ORDER_RELEASED',
  ): Promise<void> {
    await this.release(order.items);
    if (reason === 'ORDER_RELEASED' && order.couponId) {
      try {
        await this.coupons.release(order.couponId, order.userId);
      } catch (error) {
        this.logger.error(
          `Could not give back a use of coupon ${order.couponId}: ${String(error)}`,
        );
      }
    }
    await this.inventory.record(
      order.items.map((i) => ({
        productId: i.productId,
        productName: i.name,
        change: i.quantity,
        reason,
        orderId: order.id,
        isDemo: order.isDemo,
      })),
    );
  }

  private async release(lines: { productId: string; quantity: number }[]): Promise<void> {
    for (const line of lines) {
      try {
        await this.products.restoreStock(line.productId, line.quantity);
      } catch (error) {
        this.logger.error(`Could not restore stock for ${line.productId}: ${String(error)}`);
      }
    }
  }

  private notPayable(order: OrderRecord): string {
    switch (order.status) {
      case 'EXPIRED':
        return 'This order has expired. Please place a new order.';
      case 'CANCELLED':
        return 'This order was cancelled.';
      default:
        return 'This order has already been paid (simulated).';
    }
  }
}
