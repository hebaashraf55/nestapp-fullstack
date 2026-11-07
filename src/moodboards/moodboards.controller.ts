import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put } from '@nestjs/common';
import { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser, Public, Roles } from '../auth/decorators';
import { ZodPipe } from '../catalogue/dto';
import { ParseObjectIdPipe } from '../catalogue/object-id.pipe';
import { Role } from '../users/role';
import {
  MoodboardCreateDto,
  moodboardCreateSchema,
  MoodboardUpdateDto,
  moodboardUpdateSchema,
} from './dto';
import { MoodboardsService } from './moodboards.service';

/*
 * Moodboards belong to the signed-in customer; the owner always comes from the token. A shared board is
 * read through its random link only, never by id.
 */
@Controller('moodboards')
export class MoodboardsController {
  constructor(private readonly boards: MoodboardsService) {}

  @Public()
  @Get('shared/:token')
  shared(@Param('token') token: string) {
    return this.boards.shared(token);
  }

  @Roles(Role.CUSTOMER)
  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.boards.list(user);
  }

  @Roles(Role.CUSTOMER)
  @Post()
  create(
    @Body(new ZodPipe(moodboardCreateSchema)) dto: MoodboardCreateDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.boards.create(dto, user);
  }

  @Roles(Role.CUSTOMER)
  @Get(':id')
  get(@Param('id', new ParseObjectIdPipe()) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.boards.get(id.toLowerCase(), user);
  }

  @Roles(Role.CUSTOMER)
  @Patch(':id')
  update(
    @Param('id', new ParseObjectIdPipe()) id: string,
    @Body(new ZodPipe(moodboardUpdateSchema)) dto: MoodboardUpdateDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.boards.update(id.toLowerCase(), dto, user);
  }

  @Roles(Role.CUSTOMER)
  @Delete(':id')
  @HttpCode(200)
  remove(@Param('id', new ParseObjectIdPipe()) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.boards.remove(id.toLowerCase(), user);
  }

  @Roles(Role.CUSTOMER)
  @Put(':id/products/:productId')
  addProduct(
    @Param('id', new ParseObjectIdPipe()) id: string,
    @Param('productId', new ParseObjectIdPipe()) productId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.boards.addProduct(id.toLowerCase(), productId.toLowerCase(), user);
  }

  @Roles(Role.CUSTOMER)
  @Delete(':id/products/:productId')
  @HttpCode(200)
  removeProduct(
    @Param('id', new ParseObjectIdPipe()) id: string,
    @Param('productId', new ParseObjectIdPipe()) productId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.boards.removeProduct(id.toLowerCase(), productId.toLowerCase(), user);
  }

  @Roles(Role.CUSTOMER)
  @Post(':id/share')
  @HttpCode(200)
  share(@Param('id', new ParseObjectIdPipe()) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.boards.share(id.toLowerCase(), user);
  }

  @Roles(Role.CUSTOMER)
  @Delete(':id/share')
  @HttpCode(200)
  unshare(
    @Param('id', new ParseObjectIdPipe()) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.boards.unshare(id.toLowerCase(), user);
  }
}
