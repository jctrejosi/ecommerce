import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CatalogService } from './catalog.service';
import { CatalogProductsQueryDto } from './dto/catalog-products-query.dto';

@ApiTags('Admin - Catálogo')
@Controller('admin/catalog')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AdminCatalogController {
  constructor(private readonly catalogService: CatalogService) {}

  // ── Categories ──

  @Get('categories')
  @ApiOperation({ summary: 'Obtener todas las categorías (admin)' })
  @RequirePermissions('admin:catalog:categories:view')
  async getAllCategories() {
    return this.catalogService.getAllCategoriesAdmin();
  }

  @Post('categories')
  @ApiOperation({ summary: 'Crear categoría' })
  @RequirePermissions('admin:catalog:categories:create')
  async createCategory(
    @Body() body: { name: string; code?: string; parentId?: number },
  ) {
    return this.catalogService.createCategory(body);
  }

  @Post('categories/:id')
  @ApiOperation({ summary: 'Actualizar categoría' })
  @RequirePermissions('admin:catalog:categories:edit')
  async updateCategory(
    @Param('id') id: string,
    @Body()
    body: {
      name?: string;
      code?: string;
      parentId?: number | null;
      description?: string | null;
      displayOrder?: number;
      metaTitle?: string | null;
      metaDescription?: string | null;
      isActive?: boolean;
      imageUrl?: string;
    },
  ) {
    return this.catalogService.updateCategory(Number(id), body);
  }

  @Delete('categories/:id')
  @ApiOperation({ summary: 'Eliminar categoría (soft delete)' })
  @RequirePermissions('admin:catalog:categories:delete')
  async deleteCategory(@Param('id') id: string) {
    await this.catalogService.deleteCategory(Number(id));
    return { success: true };
  }

  // ── Category Products ──

  @Get('categories/:id/products')
  @ApiOperation({ summary: 'Obtener productos de una categoría' })
  @RequirePermissions('admin:catalog:categories:view')
  async getCategoryProducts(@Param('id') id: string) {
    return this.catalogService.getCategoryProducts(Number(id));
  }

  @Post('categories/:id/products')
  @ApiOperation({ summary: 'Asignar producto a categoría' })
  @RequirePermissions('admin:catalog:categories:edit')
  async addProductToCategory(
    @Param('id') id: string,
    @Body() body: { productId: number },
  ) {
    await this.catalogService.addProductToCategory(Number(id), body.productId);
    return { success: true };
  }

  @Delete('categories/:id/products/:productId')
  @ApiOperation({ summary: 'Quitar producto de categoría' })
  @RequirePermissions('admin:catalog:categories:edit')
  async removeProductFromCategory(
    @Param('id') id: string,
    @Param('productId') productId: string,
  ) {
    await this.catalogService.removeProductFromCategory(
      Number(id),
      Number(productId),
    );
    return { success: true };
  }

  // ── Product Types ──

  @Get('product-types')
  @ApiOperation({ summary: 'Obtener todos los tipos de producto (admin)' })
  @RequirePermissions('admin:catalog:product-types:view')
  async getAllProductTypes() {
    return this.catalogService.getAllProductTypesAdmin();
  }

  @Post('product-types')
  @ApiOperation({ summary: 'Crear tipo de producto' })
  @RequirePermissions('admin:catalog:product-types:create')
  async createProductType(
    @Body()
    body: {
      name: string;
      code?: string;
      description?: string;
    },
  ) {
    return this.catalogService.createProductType(body);
  }

  @Post('product-types/:id')
  @ApiOperation({ summary: 'Actualizar tipo de producto' })
  @RequirePermissions('admin:catalog:product-types:edit')
  async updateProductType(
    @Param('id') id: string,
    @Body()
    body: {
      name?: string;
      code?: string;
      description?: string | null;
      isActive?: boolean;
      imageUrl?: string;
    },
  ) {
    return this.catalogService.updateProductType(Number(id), body);
  }

  @Delete('product-types/:id')
  @ApiOperation({ summary: 'Eliminar tipo de producto' })
  @RequirePermissions('admin:catalog:product-types:delete')
  async deleteProductType(@Param('id') id: string) {
    await this.catalogService.deleteProductType(Number(id));
    return { success: true };
  }

  // ── Product Type Products ──

  @Get('product-types/:id/products')
  @ApiOperation({ summary: 'Obtener productos de un tipo de producto' })
  @RequirePermissions('admin:catalog:product-types:view')
  async getProductTypeProducts(@Param('id') id: string) {
    return this.catalogService.getProductTypeProducts(Number(id));
  }

  @Post('product-types/:id/products')
  @ApiOperation({ summary: 'Asignar producto a tipo de producto' })
  @RequirePermissions('admin:catalog:product-types:edit')
  async addProductToType(
    @Param('id') id: string,
    @Body() body: { productId: number },
  ) {
    await this.catalogService.addProductToType(Number(id), body.productId);
    return { success: true };
  }

  @Delete('product-types/:id/products/:productId')
  @ApiOperation({ summary: 'Quitar producto de tipo de producto' })
  @RequirePermissions('admin:catalog:product-types:edit')
  async removeProductFromType(
    @Param('id') id: string,
    @Param('productId') productId: string,
  ) {
    await this.catalogService.removeProductFromType(
      Number(id),
      Number(productId),
    );
    return { success: true };
  }

  // ── Products ──
  @Post('products/:productId/replace-category')
  @ApiOperation({ summary: 'Reemplazar categoría de un producto' })
  @RequirePermissions('admin:catalog:products:edit')
  async replaceProductCategory(
    @Param('productId') productId: string,
    @Body() body: { categoryId: number },
  ) {
    await this.catalogService.replaceProductCategory(
      Number(productId),
      body.categoryId,
    );
    return { success: true };
  }

  // ── Products ──

  @Post('products')
  @ApiOperation({ summary: 'Buscar productos (admin, incluye sin categoría)' })
  @RequirePermissions('admin:catalog:products:view')
  async getProducts(@Body() query: CatalogProductsQueryDto) {
    return this.catalogService.getProducts(query);
  }

  // ── Brands ──

  @Get('brands')
  @ApiOperation({ summary: 'Obtener todas las marcas (admin)' })
  @RequirePermissions('admin:catalog:brands:view')
  async getAllBrands() {
    return this.catalogService.getAllBrandsAdmin();
  }

  @Post('brands')
  @ApiOperation({ summary: 'Crear marca' })
  @RequirePermissions('admin:catalog:brands:create')
  async createBrand(
    @Body()
    body: {
      name: string;
      code?: string;
      website?: string;
      description?: string;
      country?: string;
      isFeatured?: boolean;
      isPublic?: boolean;
      imageUrl?: string;
    },
  ) {
    return this.catalogService.createBrand(body);
  }

  @Post('brands/:id')
  @ApiOperation({ summary: 'Actualizar marca' })
  @RequirePermissions('admin:catalog:brands:edit')
  async updateBrand(
    @Param('id') id: string,
    @Body()
    body: {
      name?: string;
      code?: string;
      website?: string;
      description?: string;
      country?: string;
      isFeatured?: boolean;
      isActive?: boolean;
      isPublic?: boolean;
      imageUrl?: string;
    },
  ) {
    return this.catalogService.updateBrand(Number(id), body);
  }

  @Delete('brands/:id')
  @ApiOperation({ summary: 'Eliminar marca (soft delete)' })
  @RequirePermissions('admin:catalog:brands:delete')
  async deleteBrand(@Param('id') id: string) {
    await this.catalogService.deleteBrand(Number(id));
    return { success: true };
  }

  // ── Brand Products ──

  @Get('brands/:id/products')
  @ApiOperation({ summary: 'Obtener productos de una marca' })
  @RequirePermissions('admin:catalog:brands:view')
  async getBrandProducts(@Param('id') id: string) {
    return this.catalogService.getBrandProducts(Number(id));
  }

  @Post('brands/:id/products')
  @ApiOperation({ summary: 'Asignar producto a marca' })
  @RequirePermissions('admin:catalog:brands:edit')
  async addProductToBrand(
    @Param('id') id: string,
    @Body() body: { productId: number },
  ) {
    await this.catalogService.addProductToBrand(Number(id), body.productId);
    return { success: true };
  }

  @Delete('brands/:id/products/:productId')
  @ApiOperation({ summary: 'Quitar producto de marca' })
  @RequirePermissions('admin:catalog:brands:edit')
  async removeProductFromBrand(
    @Param('id') id: string,
    @Param('productId') productId: string,
  ) {
    await this.catalogService.removeProductFromBrand(Number(productId));
    return { success: true };
  }

  // ── Suppliers ──

  @Get('suppliers')
  @ApiOperation({ summary: 'Obtener proveedores (admin, paginado)' })
  @RequirePermissions('admin:catalog:suppliers:view')
  async getAllSuppliers(
    @Query('offset') offset?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
  ) {
    return this.catalogService.getAllSuppliersAdmin({
      offset: offset !== undefined ? Number(offset) : undefined,
      limit: limit !== undefined ? Number(limit) : undefined,
      search,
    });
  }

  @Post('suppliers')
  @ApiOperation({ summary: 'Crear proveedor' })
  @RequirePermissions('admin:catalog:suppliers:create')
  async createSupplier(
    @Body()
    body: {
      legalName: string;
      code?: string;
      taxId?: string;
      contactName?: string;
      email?: string;
      phone?: string;
      address?: string;
      city?: string;
      country?: string;
      website?: string;
      paymentTermsDays?: number;
      currencyCode?: string;
      notes?: string;
    },
  ) {
    return this.catalogService.createSupplier(body);
  }

  @Post('suppliers/:id')
  @ApiOperation({ summary: 'Actualizar proveedor' })
  @RequirePermissions('admin:catalog:suppliers:edit')
  async updateSupplier(
    @Param('id') id: string,
    @Body()
    body: {
      legalName?: string;
      code?: string | null;
      taxId?: string | null;
      contactName?: string | null;
      email?: string | null;
      phone?: string | null;
      address?: string | null;
      city?: string | null;
      country?: string | null;
      website?: string | null;
      paymentTermsDays?: number | null;
      currencyCode?: string | null;
      notes?: string | null;
      isActive?: boolean;
    },
  ) {
    return this.catalogService.updateSupplier(Number(id), body);
  }

  @Delete('suppliers/:id')
  @ApiOperation({ summary: 'Eliminar proveedor (soft delete)' })
  @RequirePermissions('admin:catalog:suppliers:delete')
  async deleteSupplier(@Param('id') id: string) {
    await this.catalogService.deleteSupplier(Number(id));
    return { success: true };
  }

  // ── Supplier Products ──

  @Get('suppliers/:id/products')
  @ApiOperation({ summary: 'Obtener productos de un proveedor' })
  @RequirePermissions('admin:catalog:suppliers:view')
  async getSupplierProducts(@Param('id') id: string) {
    return this.catalogService.getSupplierProducts(Number(id));
  }

  // ── Product Suppliers ──

  @Get('products/:id/suppliers')
  @ApiOperation({ summary: 'Obtener proveedores de un producto' })
  @RequirePermissions('admin:catalog:suppliers:view')
  async getProductSuppliers(@Param('id') id: string) {
    return this.catalogService.getProductSuppliers(Number(id));
  }

  @Post('products/:id/suppliers')
  @ApiOperation({ summary: 'Asignar proveedor a producto' })
  @RequirePermissions('admin:catalog:suppliers:edit')
  async addSupplierToProduct(
    @Param('id') id: string,
    @Body() body: { supplierId: number },
  ) {
    return this.catalogService.addSupplierToProduct(
      Number(id),
      body.supplierId,
    );
  }

  @Delete('products/:id/suppliers/:supplierId')
  @ApiOperation({ summary: 'Quitar proveedor de producto' })
  @RequirePermissions('admin:catalog:suppliers:edit')
  async removeSupplierFromProduct(
    @Param('id') id: string,
    @Param('supplierId') supplierId: string,
  ) {
    await this.catalogService.removeSupplierFromProduct(
      Number(id),
      Number(supplierId),
    );
    return { success: true };
  }

  @Get('products/:id/branch-prices')
  @ApiOperation({ summary: 'Precios vigentes del producto por sucursal' })
  @RequirePermissions('admin:catalog:products:view')
  async getBranchPrices(@Param('id') id: string) {
    return this.catalogService.getBranchPrices(Number(id));
  }

  @Post('products/:id/branch-price')
  @ApiOperation({
    summary: 'Fijar el precio del producto en una sucursal (prices)',
  })
  @RequirePermissions('admin:catalog:products:edit')
  async setBranchPrice(
    @Param('id') id: string,
    @Body()
    body: { branchId: number; price: number; comparePrice?: number | null },
  ) {
    return this.catalogService.setBranchPrice(
      Number(id),
      Number(body.branchId),
      Number(body.price),
      body.comparePrice != null ? Number(body.comparePrice) : null,
    );
  }
}
