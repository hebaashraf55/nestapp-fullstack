import { Body, Controller, Get, HttpCode, Ip, Param, Patch, Post, Query } from '@nestjs/common';
import { Audited } from '../audit/audited';
import { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser, Public, Roles } from '../auth/decorators';
import { ZodPipe } from '../catalogue/dto';
import { ParseObjectIdPipe } from '../catalogue/object-id.pipe';
import { Role } from '../users/role';
import {
  CreateOrderDto,
  createOrderSchema,
  emptyBodySchema,
  GuestOrderDto,
  guestOrderSchema,
  OrderStatusDto,
  orderStatusSchema,
  ReturnDecisionDto,
  returnDecisionSchema,
  ReturnRequestDto,
  returnRequestSchema,
  ReturnsQueryDto,
  returnsQuerySchema,
  TrackDto,
  trackSchema,
} from './dto';
import { OrdersService } from './orders.service';

/*
 * Owner routes act on the signed-in user's own orders only (the owner comes from the token). Admin routes
 * are guarded by @Roles. Writes are blocked for the demo viewer by the global DemoReadOnlyGuard.
 * No route accepts card details: bodies are strict and `simulate-payment` and `refund` take none.
 */
@Controller('order')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Post()
  create(
    @Body(new ZodPipe(createOrderSchema)) dto: CreateOrderDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.orders.create(user, dto);
  }

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.orders.list(user);
  }

  /** Guest checkout. Throttled per client; the tracking code is returned once. */
  @Public()
  @Post('guest')
  createGuest(@Body(new ZodPipe(guestOrderSchema)) dto: GuestOrderDto, @Ip() ip: string) {
    return this.orders.createGuest(dto, ip);
  }

  /*
   * Guest tracking uses POST with the code in the body, so it never appears in a URL or a server log.
   * Wrong codes and unknown orders give the same 404; failures are counted per client.
   */
  @Public()
  @Post('track')
  @HttpCode(200)
  track(@Body(new ZodPipe(trackSchema)) dto: TrackDto, @Ip() ip: string) {
    return this.orders.track(dto, ip);
  }

  @Public()
  @Post('track/simulate-payment')
  @HttpCode(200)
  trackPay(@Body(new ZodPipe(trackSchema)) dto: TrackDto, @Ip() ip: string) {
    return this.orders.trackPay(dto, ip);
  }

  @Public()
  @Post('track/cancel')
  @HttpCode(200)
  trackCancel(@Body(new ZodPipe(trackSchema)) dto: TrackDto, @Ip() ip: string) {
    return this.orders.trackCancel(dto, ip);
  }

  @Roles(Role.ADMIN, Role.DEMO_VIEWER)
  @Get('returns')
  returns(
    @Query(new ZodPipe(returnsQuerySchema)) query: ReturnsQueryDto,
    @CurrentUser() viewer: AuthenticatedUser,
  ) {
    return this.orders.returns(query, viewer);
  }

  @Get(':orderId')
  get(
    @Param('orderId', new ParseObjectIdPipe()) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.orders.get(user, id);
  }

  @Post(':orderId/simulate-payment')
  @HttpCode(200)
  simulatePayment(
    @Param('orderId', new ParseObjectIdPipe()) id: string,
    @Body(new ZodPipe(emptyBodySchema)) _body: object,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.orders.simulatePayment(user, id);
  }

  @Roles(Role.CUSTOMER)
  @Post(':orderId/cancel')
  @HttpCode(200)
  cancel(
    @Param('orderId', new ParseObjectIdPipe()) id: string,
    @Body(new ZodPipe(emptyBodySchema)) _body: object,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.orders.cancelOwn(user, id);
  }

  @Roles(Role.CUSTOMER)
  @Post(':orderId/return')
  @HttpCode(200)
  requestReturn(
    @Param('orderId', new ParseObjectIdPipe()) id: string,
    @Body(new ZodPipe(returnRequestSchema)) dto: ReturnRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.orders.requestReturn(user, id, dto);
  }

  @Roles(Role.CUSTOMER)
  @Post(':orderId/reorder')
  @HttpCode(200)
  reorder(
    @Param('orderId', new ParseObjectIdPipe()) id: string,
    @Body(new ZodPipe(emptyBodySchema)) _body: object,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.orders.reorder(user, id);
  }

  @Roles(Role.ADMIN)
  @Audited('order.return', 'decision')
  @Patch(':orderId/return')
  decideReturn(
    @Param('orderId', new ParseObjectIdPipe()) id: string,
    @Body(new ZodPipe(returnDecisionSchema)) dto: ReturnDecisionDto,
  ) {
    return this.orders.decideReturn(id, dto);
  }

  @Roles(Role.ADMIN)
  @Audited('order.status', 'status')
  @Patch(':orderId/status')
  setStatus(
    @Param('orderId', new ParseObjectIdPipe()) id: string,
    @Body(new ZodPipe(orderStatusSchema)) dto: OrderStatusDto,
  ) {
    return this.orders.setStatus(id, dto);
  }

  @Roles(Role.ADMIN)
  @Audited('order.refund')
  @Post(':orderId/refund')
  @HttpCode(200)
  refund(
    @Param('orderId', new ParseObjectIdPipe()) id: string,
    @Body(new ZodPipe(emptyBodySchema)) _body: object,
  ) {
    return this.orders.refund(id);
  }
}
