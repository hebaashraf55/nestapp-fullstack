import { Body, Controller, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser, Roles } from '../auth/decorators';
import { ZodPipe } from '../catalogue/dto';
import { ParseObjectIdPipe } from '../catalogue/object-id.pipe';
import { Role } from '../users/role';
import {
  CreateOrderDto,
  createOrderSchema,
  emptyBodySchema,
  OrderStatusDto,
  orderStatusSchema,
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

  @Roles(Role.ADMIN)
  @Patch(':orderId/status')
  setStatus(
    @Param('orderId', new ParseObjectIdPipe()) id: string,
    @Body(new ZodPipe(orderStatusSchema)) dto: OrderStatusDto,
  ) {
    return this.orders.setStatus(id, dto);
  }

  @Roles(Role.ADMIN)
  @Post(':orderId/refund')
  @HttpCode(200)
  refund(
    @Param('orderId', new ParseObjectIdPipe()) id: string,
    @Body(new ZodPipe(emptyBodySchema)) _body: object,
  ) {
    return this.orders.refund(id);
  }
}
