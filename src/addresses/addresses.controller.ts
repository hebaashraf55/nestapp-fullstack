import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser, Roles } from '../auth/decorators';
import { ZodPipe } from '../catalogue/dto';
import { ParseObjectIdPipe } from '../catalogue/object-id.pipe';
import { emptyBodySchema } from '../orders/dto';
import { Role } from '../users/role';
import { AddressesService } from './addresses.service';
import {
  AddressCreateDto,
  addressCreateSchema,
  AddressUpdateDto,
  addressUpdateSchema,
} from './dto';

/** The signed-in customer's address book; the owner always comes from the token. */
@Roles(Role.CUSTOMER)
@Controller('addresses')
export class AddressesController {
  constructor(private readonly addresses: AddressesService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.addresses.list(user);
  }

  @Post()
  create(
    @Body(new ZodPipe(addressCreateSchema)) dto: AddressCreateDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.addresses.create(dto, user);
  }

  @Patch(':id')
  update(
    @Param('id', new ParseObjectIdPipe()) id: string,
    @Body(new ZodPipe(addressUpdateSchema)) dto: AddressUpdateDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.addresses.update(id.toLowerCase(), dto, user);
  }

  @Post(':id/default')
  @HttpCode(200)
  setDefault(
    @Param('id', new ParseObjectIdPipe()) id: string,
    @Body(new ZodPipe(emptyBodySchema)) _b: object,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.addresses.setDefault(id.toLowerCase(), user);
  }

  @Delete(':id')
  @HttpCode(200)
  remove(@Param('id', new ParseObjectIdPipe()) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.addresses.remove(id.toLowerCase(), user);
  }
}
