import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { Audited } from '../audit/audited';
import { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser, OptionalAuth, Public, Roles } from '../auth/decorators';
import { ZodPipe } from '../catalogue/dto';
import { ParseObjectIdPipe } from '../catalogue/object-id.pipe';
import { Role } from '../users/role';
import {
  LookCreateDto,
  lookCreateSchema,
  LookListQuery,
  lookListQuerySchema,
  LookUpdateDto,
  lookUpdateSchema,
} from './dto';
import { LooksService } from './looks.service';

/** Shop the Look: curated rooms. Browsing is public; admins curate. */
@Controller('looks')
export class LooksController {
  constructor(private readonly looks: LooksService) {}

  @Public()
  @OptionalAuth()
  @Get()
  list(
    @Query(new ZodPipe(lookListQuerySchema)) query: LookListQuery,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    return this.looks.list(query, user);
  }

  @Public()
  @OptionalAuth()
  @Get(':slug')
  get(@Param('slug') slug: string, @CurrentUser() user?: AuthenticatedUser) {
    return this.looks.get(slug, user);
  }

  @Roles(Role.ADMIN)
  @Audited('look.create')
  @Post()
  create(
    @Body(new ZodPipe(lookCreateSchema)) dto: LookCreateDto,
    @CurrentUser() admin: AuthenticatedUser,
  ) {
    return this.looks.create(dto, admin);
  }

  @Roles(Role.ADMIN)
  @Audited('look.update')
  @Patch(':id')
  update(
    @Param('id', new ParseObjectIdPipe()) id: string,
    @Body(new ZodPipe(lookUpdateSchema)) dto: LookUpdateDto,
    @CurrentUser() admin: AuthenticatedUser,
  ) {
    return this.looks.update(id.toLowerCase(), dto, admin);
  }

  @Roles(Role.ADMIN)
  @Audited('look.delete')
  @Delete(':id')
  @HttpCode(200)
  remove(@Param('id', new ParseObjectIdPipe()) id: string) {
    return this.looks.remove(id.toLowerCase());
  }
}
