import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { Audited } from '../audit/audited';
import { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser, Roles } from '../auth/decorators';
import { ParseObjectIdPipe } from '../catalogue/object-id.pipe';
import { ZodPipe } from '../catalogue/dto';
import { Role } from '../users/role';
import { CouponCreateDto, couponCreateSchema, CouponUpdateDto, couponUpdateSchema } from './dto';
import { CouponsService } from './coupons.service';

/** Coupon management is admin-only, reads included (codes are not meant to be browsable). */
@Roles(Role.ADMIN)
@Controller('coupon')
export class CouponsController {
  constructor(private readonly coupons: CouponsService) {}

  @Audited('coupon.create')
  @Post()
  create(
    @Body(new ZodPipe(couponCreateSchema)) dto: CouponCreateDto,
    @CurrentUser() admin: AuthenticatedUser,
  ) {
    return this.coupons.create(dto, admin.id);
  }

  @Get()
  list() {
    return this.coupons.list();
  }

  @Get(':id')
  get(@Param('id', new ParseObjectIdPipe()) id: string) {
    return this.coupons.get(id);
  }

  @Audited('coupon.update')
  @Patch(':id')
  update(
    @Param('id', new ParseObjectIdPipe()) id: string,
    @Body(new ZodPipe(couponUpdateSchema)) dto: CouponUpdateDto,
  ) {
    return this.coupons.update(id, dto);
  }

  @Audited('coupon.delete')
  @Delete(':id')
  @HttpCode(200)
  remove(@Param('id', new ParseObjectIdPipe()) id: string) {
    return this.coupons.remove(id);
  }
}
