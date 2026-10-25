import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AuthenticatedUser } from '../auth/auth.types';
import { CartService } from '../cart/cart.service';
import { ProductsRepository } from '../catalogue/catalogue.repositories';
import { Role } from '../users/role';
import type { CreateOrderDto, OrderStatusDto } from './dto';
import {
  canAdminTransition,
  MAX_PENDING_ORDERS,
  ORDER_TTL_MS,
  SIMULATION_NOTICE,
  type OrderStatus,
  type PaymentStatus,
} from './order-status';
import { OrderItemRecord, OrderRecord, OrdersRepository } from './orders.repository';

export interface OrderView {
  id: string;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  items: OrderItemRecord[];
  subtotalCents: number;
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
  /** Always present: every order response states that nothing real was charged. */
  payment: { mode: 'SIMULATED'; notice: string };
}

const view = (o: OrderRecord): OrderView => ({
  id: o.id,
  status: o.status,
  paymentStatus: o.paymentStatus,
  items: o.items,
  subtotalCents: o.subtotalCents,
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
  payment: { mode: 'SIMULATED', notice: SIMULATION_NOTICE },
});

const HISTORY_LIMIT = 50;
const SWEEP_BATCH = 100;

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);
  /** Users with an order being placed right now (single-instance guard against double submits). */
  private readonly placing = new Set<string>();
  /** Replaceable clock so tests can move time. */
  now: () => number = Date.now;

  constructor(
    private readonly orders: OrdersRepository,
    private readonly products: ProductsRepository,
    private readonly cart: CartService,
  ) {}

  /** Turns the caller's cart into an order, reserving stock. Prices come from the server-priced cart. */
  async create(user: AuthenticatedUser, dto: CreateOrderDto): Promise<OrderView> {
    if (this.placing.has(user.id)) {
      throw new ConflictException('Another order is already being placed for your account');
    }
    this.placing.add(user.id);
    try {
      return await this.place(user, dto);
    } finally {
      this.placing.delete(user.id);
    }
  }

  async list(user: AuthenticatedUser): Promise<OrderView[]> {
    const found = await this.orders.findByUser(user.id, HISTORY_LIMIT);
    return (await Promise.all(found.map((o) => this.expireIfDue(o)))).map(view);
  }

  /** Owners see their own orders and admins any order; everyone else gets 404 (no existence leak). */
  async get(user: AuthenticatedUser, id: string): Promise<OrderView> {
    const order = await this.orders.findById(id);
    if (!order || (order.userId !== user.id && user.role !== Role.ADMIN)) {
      throw new NotFoundException('Order not found');
    }
    return view(await this.expireIfDue(order));
  }

  /** Pretend to pay. Only the owner can, only once, and only before the order expires. */
  async simulatePayment(user: AuthenticatedUser, id: string): Promise<OrderView> {
    const found = await this.orders.findById(id);
    if (!found || found.userId !== user.id) throw new NotFoundException('Order not found');
    const order = await this.expireIfDue(found);
    if (order.status !== 'PENDING_PAYMENT') {
      throw new ConflictException(this.notPayable(order));
    }
    const paid = await this.orders.transition(order.id, ['PENDING_PAYMENT'], {
      status: 'PAID',
      paymentStatus: 'SIMULATED_PAID',
      paidAt: new Date(this.now()),
    });
    if (!paid) {
      // Lost a race with another payment, a cancellation or the expiry sweep.
      const latest = (await this.orders.findById(id)) ?? order;
      throw new ConflictException(this.notPayable(latest));
    }
    return view(paid);
  }

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
    const patch =
      dto.status === 'CANCELLED'
        ? { status: dto.status, cancelledAt: new Date(this.now()) }
        : { status: dto.status };
    const updated = await this.orders.transition(order.id, [order.status], patch);
    if (!updated)
      throw new ConflictException('The order was changed by someone else. Please reload.');
    if (dto.status === 'CANCELLED') await this.restoreStock(updated);
    return view(updated);
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
    const refunded = await this.orders.transition(order.id, ['PAID'], {
      status: 'CANCELLED',
      paymentStatus: 'SIMULATED_REFUNDED',
      refundedAt: new Date(this.now()),
      cancelledAt: new Date(this.now()),
    });
    if (!refunded)
      throw new ConflictException('The order was changed by someone else. Please reload.');
    await this.restoreStock(refunded);
    return view(refunded);
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

  private async place(user: AuthenticatedUser, dto: CreateOrderDto): Promise<OrderView> {
    const cart = await this.cart.get(user.id);
    if (cart.items.length === 0) throw new BadRequestException('Your cart is empty');
    if (cart.hasIssues) {
      throw new ConflictException(
        'Some items in your cart are unavailable or out of stock. Please review your cart.',
      );
    }
    // Pay or let old orders lapse first; expired ones free their slot.
    await this.expireOverdueFor(user.id);
    if ((await this.orders.countPending(user.id)) >= MAX_PENDING_ORDERS) {
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

    let order: OrderRecord;
    try {
      order = await this.orders.create({
        userId: user.id,
        isDemo: user.isDemo,
        items: cart.items.map((l) => ({
          productId: l.productId,
          name: l.name ?? '',
          unitPriceCents: l.unitPriceCents,
          quantity: l.quantity,
          lineTotalCents: l.lineTotalCents,
        })),
        subtotalCents: cart.subtotalCents,
        couponCode: cart.coupon?.code ?? null,
        couponPercent: cart.coupon?.discountPercent ?? null,
        discountCents: cart.discountCents,
        totalCents: cart.totalCents,
        currency: cart.currency,
        address: dto.address,
        phone: dto.phone,
        status: 'PENDING_PAYMENT',
        paymentStatus: 'SIMULATED_UNPAID',
        expiresAt: new Date(this.now() + ORDER_TTL_MS),
        paidAt: null,
        refundedAt: null,
        cancelledAt: null,
      });
    } catch (error) {
      await this.release(reserved); // never keep stock for an order that was not saved
      throw error;
    }

    try {
      await this.cart.clear(user.id);
    } catch (error) {
      // The order exists and holds its stock; a leftover cart is the lesser problem.
      this.logger.warn(`Could not clear the cart after order ${order.id}: ${String(error)}`);
    }
    return view(order);
  }

  /** Lazily expires an unpaid order whose hold ran out, restoring its stock. Returns the current state. */
  private async expireIfDue(order: OrderRecord): Promise<OrderRecord> {
    if (order.status !== 'PENDING_PAYMENT' || order.expiresAt.getTime() > this.now()) return order;
    const expired = await this.orders.transition(order.id, ['PENDING_PAYMENT'], {
      status: 'EXPIRED',
    });
    if (expired) {
      await this.restoreStock(expired); // only the caller that won the transition restores
      return expired;
    }
    return (await this.orders.findById(order.id)) ?? order;
  }

  private async expireOverdueFor(userId: string): Promise<void> {
    for (const order of await this.orders.findByUser(userId, HISTORY_LIMIT)) {
      await this.expireIfDue(order);
    }
  }

  private async restoreStock(order: OrderRecord): Promise<void> {
    await this.release(order.items);
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
