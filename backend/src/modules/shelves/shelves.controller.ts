import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type {
  CreateShelfDto,
  SetLocationDto,
  UpdateShelfDto,
} from './shelves.service';
import { ShelvesService } from './shelves.service';

/**
 * Admin de picking: estanterías por sucursal y ubicación de productos.
 * Ruta pública (como /picking) — sin login por ahora.
 */
@ApiTags('Picking Admin')
@Controller('picking-admin')
export class ShelvesController {
  constructor(private readonly shelvesService: ShelvesService) {}

  // ── Sucursales ──

  @Get('branches')
  @ApiOperation({ summary: 'Sucursales para el selector del admin de picking' })
  branches() {
    return this.shelvesService.branches();
  }

  // ── Estanterías ──

  @Get('shelves')
  @ApiOperation({ summary: 'Estanterías de una sucursal (con filas)' })
  listShelves(@Query('branchId') branchId?: string) {
    return this.shelvesService.listShelves(branchId ? Number(branchId) : undefined);
  }

  @Post('shelves')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Crear estantería con sus filas' })
  createShelf(@Body() dto: CreateShelfDto) {
    return this.shelvesService.createShelf(dto);
  }

  @Put('shelves/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Actualizar estantería (campos + filas)' })
  updateShelf(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateShelfDto) {
    return this.shelvesService.updateShelf(id, dto);
  }

  @Delete('shelves/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Eliminar estantería (borra filas y ubicaciones en cascada)' })
  deleteShelf(@Param('id', ParseIntPipe) id: number) {
    return this.shelvesService.deleteShelf(id);
  }

  // ── Productos / ubicaciones ──

  @Get('products')
  @ApiOperation({ summary: 'Productos con inventario en la sucursal + ubicación' })
  listProducts(
    @Query('branchId') branchId: string,
    @Query('search') search?: string,
  ) {
    const branch = Number(branchId);
    if (!branch) throw new BadRequestException('branchId es obligatorio');
    return this.shelvesService.listProducts(branch, search);
  }

  @Post('products/locations')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Asignar (upsert) ubicación de un producto en una sucursal' })
  setLocation(@Body() dto: SetLocationDto) {
    return this.shelvesService.setLocation(dto);
  }

  @Delete('products/locations/:productVariantId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Quitar la ubicación de un producto en una sucursal' })
  removeLocation(
    @Param('productVariantId', ParseIntPipe) productVariantId: number,
    @Query('branchId') branchId: string,
  ) {
    return this.shelvesService.removeLocation(productVariantId, Number(branchId));
  }

  @Get('locations')
  @ApiOperation({
    summary: 'Ubicaciones de variantes en una sucursal (para el mapa del picking)',
  })
  locationsByVariants(
    @Query('branchId') branchId: string,
    @Query('variantIds') variantIds?: string,
  ) {
    const branch = Number(branchId);
    if (!branch) throw new BadRequestException('branchId es obligatorio');
    const ids = (variantIds ?? '')
      .split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isInteger(n) && n > 0);
    return this.shelvesService.locationsByVariants(branch, ids);
  }

  @Post('products/locations/bulk-assign')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Asignar ubicación a todos los productos con inventario de la sucursal',
  })
  bulkAssign(
    @Body() dto: { branchId: number; shelfId: number; rowNumber: number; onlyUnassigned?: boolean },
  ) {
    if (!dto?.branchId || !dto?.shelfId || !dto?.rowNumber) {
      throw new BadRequestException('branchId, shelfId y rowNumber son obligatorios');
    }
    return this.shelvesService.bulkAssign(
      Number(dto.branchId),
      Number(dto.shelfId),
      Number(dto.rowNumber),
      dto.onlyUnassigned,
    );
  }
}
