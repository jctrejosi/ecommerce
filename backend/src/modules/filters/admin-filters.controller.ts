import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Put, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { FiltersService } from './filters.service';
import { CreateFilterDto, UpdateFilterDto } from './dto/filter.dto';

@ApiTags('Admin - Filtros')
@Controller('admin/filters')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AdminFiltersController {
  constructor(private readonly filtersService: FiltersService) {}

  @Get()
  @ApiOperation({ summary: 'Listar filtros guardados' })
  @RequirePermissions('admin:catalog:filters:view')
  findAll() { return this.filtersService.findAll(); }

  @Get(':id')
  @ApiOperation({ summary: 'Obtener detalle de un filtro' })
  @RequirePermissions('admin:catalog:filters:view')
  findOne(@Param('id') id: string) { return this.filtersService.findOne(Number(id)); }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Crear filtro' })
  @RequirePermissions('admin:catalog:filters:manage')
  create(@Body() dto: CreateFilterDto) { return this.filtersService.create(dto); }

  @Put(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Actualizar filtro' })
  @RequirePermissions('admin:catalog:filters:manage')
  update(@Param('id') id: string, @Body() dto: UpdateFilterDto) { return this.filtersService.update(Number(id), dto); }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Eliminar filtro' })
  @RequirePermissions('admin:catalog:filters:manage')
  remove(@Param('id') id: string) { return this.filtersService.remove(Number(id)); }
}
