import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser, OptionalAuth, Public, Roles } from '../auth/decorators';
import { Role } from '../users/role';
import { BrandsService, CategoriesService, ProductsService } from './catalogue.services';
import {
  ProductCreateDto,
  productCreateSchema,
  ProductQueryDto,
  productQuerySchema,
  ProductUpdateDto,
  productUpdateSchema,
  TaxonomyCreateDto,
  taxonomyCreateSchema,
  TaxonomyUpdateDto,
  taxonomyUpdateSchema,
  ZodPipe,
} from './dto';
import { ParseObjectIdPipe } from './object-id.pipe';

/*
 * Reads are public (the storefront is browsable without an account); every write needs the ADMIN role,
 * enforced by the global guards. @OptionalAuth only lets a signed-in demo viewer be recognised so it
 * sees synthetic records only. Paths keep the original API's `/create` convention for ported routes.
 */

@Controller('brand')
export class BrandController {
  constructor(private readonly brands: BrandsService) {}

  @Roles(Role.ADMIN)
  @Post('create')
  create(
    @Body(new ZodPipe(taxonomyCreateSchema)) dto: TaxonomyCreateDto,
    @CurrentUser() admin: AuthenticatedUser,
  ) {
    return this.brands.create(dto, admin.id);
  }

  @Public()
  @OptionalAuth()
  @Get()
  list(@CurrentUser() user?: AuthenticatedUser) {
    return this.brands.list(user);
  }

  @Public()
  @OptionalAuth()
  @Get(':id')
  get(@Param('id', new ParseObjectIdPipe()) id: string, @CurrentUser() user?: AuthenticatedUser) {
    return this.brands.get(id, user);
  }

  @Roles(Role.ADMIN)
  @Patch(':id')
  update(
    @Param('id', new ParseObjectIdPipe()) id: string,
    @Body(new ZodPipe(taxonomyUpdateSchema)) dto: TaxonomyUpdateDto,
  ) {
    return this.brands.update(id, dto);
  }

  @Roles(Role.ADMIN)
  @Delete(':id')
  @HttpCode(200)
  remove(@Param('id', new ParseObjectIdPipe()) id: string) {
    return this.brands.remove(id);
  }
}

@Controller('category')
export class CategoryController {
  constructor(private readonly categories: CategoriesService) {}

  @Roles(Role.ADMIN)
  @Post('create')
  create(
    @Body(new ZodPipe(taxonomyCreateSchema)) dto: TaxonomyCreateDto,
    @CurrentUser() admin: AuthenticatedUser,
  ) {
    return this.categories.create(dto, admin.id);
  }

  @Public()
  @OptionalAuth()
  @Get()
  list(@CurrentUser() user?: AuthenticatedUser) {
    return this.categories.list(user);
  }

  @Public()
  @OptionalAuth()
  @Get(':id')
  get(@Param('id', new ParseObjectIdPipe()) id: string, @CurrentUser() user?: AuthenticatedUser) {
    return this.categories.get(id, user);
  }

  @Roles(Role.ADMIN)
  @Patch(':id')
  update(
    @Param('id', new ParseObjectIdPipe()) id: string,
    @Body(new ZodPipe(taxonomyUpdateSchema)) dto: TaxonomyUpdateDto,
  ) {
    return this.categories.update(id, dto);
  }

  @Roles(Role.ADMIN)
  @Delete(':id')
  @HttpCode(200)
  remove(@Param('id', new ParseObjectIdPipe()) id: string) {
    return this.categories.remove(id);
  }
}

@Controller('product')
export class ProductController {
  constructor(private readonly products: ProductsService) {}

  @Roles(Role.ADMIN)
  @Post('create')
  create(
    @Body(new ZodPipe(productCreateSchema)) dto: ProductCreateDto,
    @CurrentUser() admin: AuthenticatedUser,
  ) {
    return this.products.create(dto, admin.id);
  }

  @Public()
  @OptionalAuth()
  @Get()
  list(
    @Query(new ZodPipe(productQuerySchema)) query: ProductQueryDto,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    return this.products.list(query, user);
  }

  @Public()
  @OptionalAuth()
  @Get(':id')
  get(@Param('id', new ParseObjectIdPipe()) id: string, @CurrentUser() user?: AuthenticatedUser) {
    return this.products.get(id, user);
  }

  @Roles(Role.ADMIN)
  @Patch(':id')
  update(
    @Param('id', new ParseObjectIdPipe()) id: string,
    @Body(new ZodPipe(productUpdateSchema)) dto: ProductUpdateDto,
  ) {
    return this.products.update(id, dto);
  }

  @Roles(Role.ADMIN)
  @Delete(':id')
  @HttpCode(200)
  remove(@Param('id', new ParseObjectIdPipe()) id: string) {
    return this.products.remove(id);
  }
}
