import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Put, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { BranchesService } from './branches.service';
import { CreateBranchDto, UpdateBranchDto, CreateDeliveryZoneDto } from './dto/branch.dto';

@ApiTags('Admin - Sucursales')
@Controller('admin/branches')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AdminBranchesController {
  constructor(private readonly branchesService: BranchesService) {}

  @Get()
  @ApiOperation({ summary: 'Listar todas las sucursales' })
  @RequirePermissions('admin:catalog:branches:view')
  findAll() { return this.branchesService.findAll(); }

  @Get(':id')
  @ApiOperation({ summary: 'Obtener detalle de sucursal' })
  @RequirePermissions('admin:catalog:branches:view')
  findOne(@Param('id') id: string) { return this.branchesService.findOne(Number(id)); }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Crear sucursal' })
  @RequirePermissions('admin:catalog:branches:create')
  create(@Body() dto: CreateBranchDto) { return this.branchesService.create(dto); }

  @Put(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Actualizar sucursal' })
  @RequirePermissions('admin:catalog:branches:edit')
  update(@Param('id') id: string, @Body() dto: UpdateBranchDto) { return this.branchesService.update(Number(id), dto); }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Eliminar sucursal (soft delete)' })
  @RequirePermissions('admin:catalog:branches:delete')
  remove(@Param('id') id: string) { return this.branchesService.remove(Number(id)); }

  // ── Products / Categories / Brands ──

  @Get(':id/products')
  @ApiOperation({ summary: 'Productos en inventario de la sucursal' })
  @RequirePermissions('admin:catalog:branches:view')
  getProducts(@Param('id') id: string) { return this.branchesService.getProducts(Number(id)); }

  @Get(':id/categories')
  @ApiOperation({ summary: 'Categorías con productos en la sucursal' })
  @RequirePermissions('admin:catalog:branches:view')
  getCategories(@Param('id') id: string) { return this.branchesService.getCategories(Number(id)); }

  @Get(':id/brands')
  @ApiOperation({ summary: 'Marcas con productos en la sucursal' })
  @RequirePermissions('admin:catalog:branches:view')
  getBrands(@Param('id') id: string) { return this.branchesService.getBrands(Number(id)); }

  // ── Delivery Zones ──

  @Get(':id/delivery-zones')
  @ApiOperation({ summary: 'Zonas de entrega de la sucursal' })
  @RequirePermissions('admin:catalog:branches:view')
  getDeliveryZones(@Param('id') id: string) { return this.branchesService.getDeliveryZones(Number(id)); }

  @Post(':id/delivery-zones')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Crear zona de entrega' })
  @RequirePermissions('admin:catalog:branches:edit')
  createDeliveryZone(@Param('id') id: string, @Body() dto: CreateDeliveryZoneDto) {
    return this.branchesService.createDeliveryZone(Number(id), dto);
  }

  @Delete(':id/delivery-zones/:zoneId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Eliminar zona de entrega' })
  @RequirePermissions('admin:catalog:branches:edit')
  removeDeliveryZone(@Param('id') id: string, @Param('zoneId') zoneId: string) {
    return this.branchesService.removeDeliveryZone(Number(id), Number(zoneId));
  }
}
