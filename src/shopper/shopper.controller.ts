import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put } from '@nestjs/common';
import { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators';
import { ZodPipe } from '../catalogue/dto';
import { ParseObjectIdPipe } from '../catalogue/object-id.pipe';
import { MergeIdsDto, mergeIdsSchema } from './dto';
import { ShopperService } from './shopper.service';

/*
 * The owner is always the signed-in user; nothing in a path or body can name another account.
 * Writes are blocked for the demo viewer by the global DemoReadOnlyGuard.
 */
@Controller('wishlist')
export class WishlistController {
  constructor(private readonly shopper: ShopperService) {}

  @Get()
  get(@CurrentUser() user: AuthenticatedUser) {
    return this.shopper.wishlist(user);
  }

  @Put(':productId')
  add(
    @Param('productId', new ParseObjectIdPipe()) productId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.shopper.addToWishlist(user, productId.toLowerCase());
  }

  @Delete(':productId')
  remove(
    @Param('productId', new ParseObjectIdPipe()) productId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.shopper.removeFromWishlist(user, productId.toLowerCase());
  }

  @Post('merge')
  @HttpCode(200)
  merge(
    @Body(new ZodPipe(mergeIdsSchema)) dto: MergeIdsDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.shopper.mergeWishlist(user, dto.productIds);
  }
}

@Controller('recently-viewed')
export class RecentlyViewedController {
  constructor(private readonly shopper: ShopperService) {}

  @Get()
  get(@CurrentUser() user: AuthenticatedUser) {
    return this.shopper.recentlyViewed(user);
  }

  @Post('merge')
  @HttpCode(200)
  merge(
    @Body(new ZodPipe(mergeIdsSchema)) dto: MergeIdsDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.shopper.mergeRecentlyViewed(user, dto.productIds);
  }

  @Post(':productId')
  @HttpCode(200)
  record(
    @Param('productId', new ParseObjectIdPipe()) productId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.shopper.recordView(user, productId.toLowerCase());
  }
}
