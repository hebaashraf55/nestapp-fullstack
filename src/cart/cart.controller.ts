import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser, Public, Roles } from '../auth/decorators';
import { Role } from '../users/role';
import { ZodPipe } from '../catalogue/dto';
import { ParseObjectIdPipe } from '../catalogue/object-id.pipe';
import { CartService } from './cart.service';
import {
  AddManyToCartDto,
  addManyToCartSchema,
  CartLinesDto,
  cartLinesSchema,
  AddToCartDto,
  addToCartSchema,
  ApplyCouponDto,
  applyCouponSchema,
  UpdateCartDto,
  updateCartSchema,
} from './dto';

/*
 * Every route acts on the signed-in user's own cart: the owner is always taken from the authenticated
 * request, never from a path, query or body. Writes are blocked for the demo viewer by the global
 * DemoReadOnlyGuard; reading is allowed and returns an empty cart for that account.
 */
@Controller('cart')
export class CartController {
  constructor(private readonly cart: CartService) {}

  @Post()
  add(
    @Body(new ZodPipe(addToCartSchema)) dto: AddToCartDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.cart.add(user.id, dto.productId, dto.quantity);
  }

  @Post('batch')
  addMany(
    @Body(new ZodPipe(addManyToCartSchema)) dto: AddManyToCartDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.cart.addMany(user.id, dto.items);
  }

  /** Prices a guest's browser cart. Nothing is stored; coupons need an account. */
  @Public()
  @Post('quote')
  @HttpCode(200)
  quote(@Body(new ZodPipe(cartLinesSchema)) dto: CartLinesDto) {
    return this.cart.quote(dto.items);
  }

  /** Merges a guest cart after sign-in: what is still available is added, the rest is reported. */
  @Roles(Role.CUSTOMER)
  @Post('merge')
  @HttpCode(200)
  merge(
    @Body(new ZodPipe(cartLinesSchema)) dto: CartLinesDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.cart.addAvailable(user.id, dto.items);
  }

  @Get()
  get(@CurrentUser() user: AuthenticatedUser) {
    return this.cart.get(user.id);
  }

  @Post('apply-coupon')
  @HttpCode(200)
  applyCoupon(
    @Body(new ZodPipe(applyCouponSchema)) dto: ApplyCouponDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.cart.applyCoupon(user.id, dto.code);
  }

  @Delete('coupon')
  @HttpCode(200)
  removeCoupon(@CurrentUser() user: AuthenticatedUser) {
    return this.cart.removeCoupon(user.id);
  }

  @Patch(':productId')
  update(
    @Param('productId', new ParseObjectIdPipe()) productId: string,
    @Body(new ZodPipe(updateCartSchema)) dto: UpdateCartDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.cart.update(user.id, productId, dto.quantity);
  }

  @Delete(':productId')
  @HttpCode(200)
  remove(
    @Param('productId', new ParseObjectIdPipe()) productId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.cart.remove(user.id, productId);
  }
}
