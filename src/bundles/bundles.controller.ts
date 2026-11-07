import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { Audited } from '../audit/audited';
import { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser, OptionalAuth, Public, Roles } from '../auth/decorators';
import { ZodPipe } from '../catalogue/dto';
import { ParseObjectIdPipe } from '../catalogue/object-id.pipe';
import { Role } from '../users/role';
import {
  BundleCreateDto,
  bundleCreateSchema,
  BundleListQuery,
  bundleListQuerySchema,
  BundleUpdateDto,
  bundleUpdateSchema,
} from './dto';
import { BundlesService } from './bundles.service';

/** Product bundles: browsing is public; only admins create, change or delete them. */
@Controller('bundles')
export class BundlesController {
  constructor(private readonly bundles: BundlesService) {}

  @Public()
  @OptionalAuth()
  @Get()
  list(
    @Query(new ZodPipe(bundleListQuerySchema)) query: BundleListQuery,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    return this.bundles.list(query, user);
  }

  @Public()
  @OptionalAuth()
  @Get(':slug')
  get(@Param('slug') slug: string, @CurrentUser() user?: AuthenticatedUser) {
    if (!/^[a-z0-9-]{1,100}$/i.test(slug)) return this.bundles.get('-', user);
    return this.bundles.get(slug, user);
  }

  @Roles(Role.ADMIN)
  @Audited('bundle.create')
  @Post()
  create(
    @Body(new ZodPipe(bundleCreateSchema)) dto: BundleCreateDto,
    @CurrentUser() admin: AuthenticatedUser,
  ) {
    return this.bundles.create(dto, admin);
  }

  @Roles(Role.ADMIN)
  @Audited('bundle.update')
  @Patch(':id')
  update(
    @Param('id', new ParseObjectIdPipe()) id: string,
    @Body(new ZodPipe(bundleUpdateSchema)) dto: BundleUpdateDto,
    @CurrentUser() admin: AuthenticatedUser,
  ) {
    return this.bundles.update(id.toLowerCase(), dto, admin);
  }

  @Roles(Role.ADMIN)
  @Audited('bundle.delete')
  @Delete(':id')
  @HttpCode(200)
  remove(@Param('id', new ParseObjectIdPipe()) id: string) {
    return this.bundles.remove(id.toLowerCase());
  }
}
