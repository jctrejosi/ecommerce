import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../../common/guards/optional-jwt-auth.guard';
import { BranchScopeService } from '../../common/branch-scope/branch-scope.service';
import { SuperuserGuard } from '../delivery/superuser.guard';
import type {
  CreateShelfDto,
  SetLocationDto,
  UpdateShelfDto,
} from './shelves.service';
import { ShelvesService } from './shelves.service';

/**
 * Admin de picking: estanterías por sucursal y ubicación de productos.
 *
 * Las rutas usan autenticación **opcional**: sin token siguen siendo públicas
 * (la app móvil las consume con el token de un picker, que **no** lleva alcance
 * de sucursal). Cuando entra un **admin de sucursal** (superusuario con
 * sucursal), todas las lecturas/escrituras quedan forzadas a su sucursal; el
 * **admin global** (sin sucursal) mantiene acceso a todas.
 */
@ApiTags('Picking Admin')
@Controller('picking-admin')
export class ShelvesController {
  constructor(
    private readonly shelvesService: ShelvesService,
    private readonly branchScope: BranchScopeService,
  ) {}

  /** Sucursal forzada del admin actual, o `null` si es global/sin alcance. */
  private scope(userId: bigint | null): Promise<number | null> {
    return this.branchScope.scopeOf(userId != null ? Number(userId) : null);
  }

  private assertInScope(scope: number | null, branchId: number, action: string) {
    if (scope != null && branchId !== scope) {
      throw new ForbiddenException(`Solo puedes ${action} en tu sucursal`);
    }
  }

  // ── Sucursales ──

  @Get('branches')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({ summary: 'Sucursales para el selector del admin de picking' })
  async branches(@CurrentUser('sub') userId: bigint | null) {
    const scope = await this.scope(userId);
    const all = await this.shelvesService.branches();
    return scope != null ? all.filter((b) => b.id === scope) : all;
  }

  @Get('branches/:id/schedule')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({ summary: 'Horario de una sucursal (días → HH:MM-HH:MM)' })
  async branchSchedule(
    @CurrentUser('sub') userId: bigint | null,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const scope = await this.scope(userId);
    this.assertInScope(scope, id, 'ver horarios');
    return this.shelvesService.getSchedule(id);
  }

  @Put('branches/:id/schedule')
  @UseGuards(JwtAuthGuard, SuperuserGuard)
  @ApiOperation({ summary: 'Guarda el horario de una sucursal' })
  async saveBranchSchedule(
    @CurrentUser('sub') userId: bigint | null,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: { schedule?: Record<string, string> },
  ) {
    if (!dto?.schedule) {
      throw new BadRequestException('Se requiere el campo schedule');
    }
    const scope = await this.scope(userId);
    this.assertInScope(scope, id, 'editar horarios');
    return this.shelvesService.saveSchedule(id, dto.schedule);
  }

  @Get('shift-today')
  @ApiOperation({ summary: 'Cierre de turno más tardío entre sucursales hoy' })
  shiftToday() {
    return this.shelvesService.shiftToday();
  }

  @Get('categories')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({ summary: 'Categorías para asociar a las estanterías' })
  async categories(
    @CurrentUser('sub') userId: bigint | null,
    @Query('branchId') branchId?: string,
  ) {
    const scope = await this.scope(userId);
    const parsed = branchId ? Number.parseInt(branchId, 10) : NaN;
    const effective = scope ?? (Number.isInteger(parsed) ? parsed : null);
    return this.shelvesService.categories(effective);
  }

  @Get('categories/:id/organization')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({
    summary: 'Estanterías y productos de una categoría (organización por categoría)',
  })
  async categoryOrganization(
    @CurrentUser('sub') userId: bigint | null,
    @Param('id', ParseIntPipe) id: number,
    @Query('branchId') branchId?: string,
  ) {
    const scope = await this.scope(userId);
    const effective =
      scope ?? (branchId ? Number(branchId) : undefined);
    return this.shelvesService.categoryOrganization(id, effective);
  }

  // ── Estanterías ──

  @Get('shelves')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({ summary: 'Estanterías de una sucursal (con filas)' })
  async listShelves(
    @CurrentUser('sub') userId: bigint | null,
    @Query('branchId') branchId?: string,
  ) {
    const scope = await this.scope(userId);
    const effective = scope ?? (branchId ? Number(branchId) : undefined);
    return this.shelvesService.listShelves(effective);
  }

  @Post('shelves')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({ summary: 'Crear estantería con sus filas' })
  async createShelf(
    @CurrentUser('sub') userId: bigint | null,
    @Body() dto: CreateShelfDto,
  ) {
    const scope = await this.scope(userId);
    // El admin de sucursal solo crea en la suya.
    const effective = { ...dto, branchId: scope ?? dto.branchId };
    return this.shelvesService.createShelf(effective);
  }

  @Put('shelves/:id')
  @HttpCode(HttpStatus.OK)
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({ summary: 'Actualizar estantería (campos + filas)' })
  async updateShelf(
    @CurrentUser('sub') userId: bigint | null,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateShelfDto,
  ) {
    const scope = await this.scope(userId);
    if (scope != null) {
      const branch = await this.branchScope.shelfBranch(id);
      this.assertInScope(scope, branch ?? -1, 'editar estanterías');
    }
    return this.shelvesService.updateShelf(id, dto);
  }

  @Delete('shelves/:id')
  @HttpCode(HttpStatus.OK)
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({ summary: 'Eliminar estantería (borra filas y ubicaciones en cascada)' })
  async deleteShelf(
    @CurrentUser('sub') userId: bigint | null,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const scope = await this.scope(userId);
    if (scope != null) {
      const branch = await this.branchScope.shelfBranch(id);
      this.assertInScope(scope, branch ?? -1, 'eliminar estanterías');
    }
    return this.shelvesService.deleteShelf(id);
  }

  // ── Productos / ubicaciones ──

  @Get('products')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({ summary: 'Productos con inventario en la sucursal + ubicación' })
  async listProducts(
    @CurrentUser('sub') userId: bigint | null,
    @Query('branchId') branchId: string,
    @Query('search') search?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const scope = await this.scope(userId);
    const branch = scope ?? Number(branchId);
    if (!branch) throw new BadRequestException('branchId es obligatorio');
    const parsedLimit = limit ? Number.parseInt(limit, 10) : NaN;
    const parsedOffset = offset ? Number.parseInt(offset, 10) : NaN;
    return this.shelvesService.listProducts(
      branch,
      search,
      Number.isInteger(parsedLimit) ? parsedLimit : undefined,
      Number.isInteger(parsedOffset) ? parsedOffset : undefined,
    );
  }

  @Post('products/locations')
  @HttpCode(HttpStatus.OK)
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({ summary: 'Asignar (upsert) ubicación de un producto en una sucursal' })
  async setLocation(
    @CurrentUser('sub') userId: bigint | null,
    @Body() dto: SetLocationDto,
  ) {
    const scope = await this.scope(userId);
    const effective = { ...dto, branchId: scope ?? dto.branchId };
    return this.shelvesService.setLocation(effective);
  }

  @Delete('products/locations/:productVariantId')
  @HttpCode(HttpStatus.OK)
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({ summary: 'Quitar la ubicación de un producto en una sucursal' })
  async removeLocation(
    @CurrentUser('sub') userId: bigint | null,
    @Param('productVariantId', ParseIntPipe) productVariantId: number,
    @Query('branchId') branchId: string,
  ) {
    const scope = await this.scope(userId);
    const branch = scope ?? Number(branchId);
    if (!branch) throw new BadRequestException('branchId es obligatorio');
    return this.shelvesService.removeLocation(productVariantId, branch);
  }

  @Get('locations')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({
    summary: 'Ubicaciones de variantes en una sucursal (para el mapa del picking)',
  })
  async locationsByVariants(
    @CurrentUser('sub') userId: bigint | null,
    @Query('branchId') branchId: string,
    @Query('variantIds') variantIds?: string,
  ) {
    const scope = await this.scope(userId);
    const branch = scope ?? Number(branchId);
    if (!branch) throw new BadRequestException('branchId es obligatorio');
    const ids = (variantIds ?? '')
      .split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isInteger(n) && n > 0);
    return this.shelvesService.locationsByVariants(branch, ids);
  }

  @Post('products/locations/bulk-assign')
  @HttpCode(HttpStatus.OK)
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({
    summary: 'Asignar ubicación a todos los productos con inventario de la sucursal',
  })
  async bulkAssign(
    @CurrentUser('sub') userId: bigint | null,
    @Body() dto: { branchId: number; shelfId: number; onlyUnassigned?: boolean },
  ) {
    const scope = await this.scope(userId);
    const branchId = scope ?? Number(dto?.branchId);
    if (!branchId || !dto?.shelfId) {
      throw new BadRequestException('branchId y shelfId son obligatorios');
    }
    return this.shelvesService.bulkAssign(
      branchId,
      Number(dto.shelfId),
      dto.onlyUnassigned,
    );
  }
}
