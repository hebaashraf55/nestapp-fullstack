import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators';
import { ZodPipe } from '../catalogue/dto';
import { ParseObjectIdPipe } from '../catalogue/object-id.pipe';
import { CartService } from './cart.service';
import {
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
