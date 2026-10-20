import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { BranchScopeService } from '../../common/branch-scope/branch-scope.service';
import { SuperuserGuard } from './superuser.guard';
import { DeliveryAdminService } from './delivery-admin.service';
import { DriverChatService } from './driver-chat.service';
import {
  CreateDriverDto,
  ResetPasswordDto,
  UpdateDriverDto,
} from './dto/admin-driver.dto';
import { SendMessageDto } from './dto/send-message.dto';

/**
 * Endpoints administrativos del delivery (panel web delivery-admin).
 * Acceso solo para administradores (isSuperuser).
 *
 * El **admin de sucursal** (superusuario con sucursal) queda forzado a su
 * sucursal en flota, pedidos y usuarios de repartidor; el **admin global**
 * (superusuario sin sucursal) ve todo y filtra por el selector del panel.
 */
@Controller('delivery/admin')
@UseGuards(JwtAuthGuard, SuperuserGuard)
export class DeliveryAdminController {
  constructor(
    private readonly admin: DeliveryAdminService,
    private readonly chat: DriverChatService,
    private readonly branchScope: BranchScopeService,
  ) {}

  /** Sucursal forzada del admin actual, o `null` si es global/sin alcance. */
  private scope(userId: bigint): Promise<number | null> {
    return this.branchScope.scopeOf(Number(userId));
  }

  /** Sucursal efectiva: el alcance del admin gana sobre lo que pida la URL. */
  private async effectiveBranch(
    userId: bigint,
    branchId?: string,
  ): Promise<number | null> {
    const scope = await this.scope(userId);
    if (scope != null) return scope;
    const parsed = branchId ? Number.parseInt(branchId, 10) : NaN;
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  }

  /** Un admin de sucursal solo accede a repartidores de su sucursal. */
  private async assertDriverInScope(userId: bigint, driverId: number) {
    const scope = await this.scope(userId);
    if (scope == null) return;
    const target = await this.admin.driverBranch(driverId);
    if (target !== scope) {
      throw new ForbiddenException('Ese repartidor no pertenece a tu sucursal');
    }
  }

  /** Sucursales para el selector del panel (el admin de sucursal ve solo la suya). */
  @Get('branches')
  async listBranches(@CurrentUser('sub') userId: bigint) {
    const scope = await this.scope(userId);
    const all = await this.admin.branches();
    return scope != null ? all.filter((b) => b.id === scope) : all;
  }

  /** Flota completa con posición y pedido activo de cada repartidor. */
  @Get('drivers')
  async listDrivers(
    @CurrentUser('sub') userId: bigint,
    @Query('branchId') branchId?: string,
  ) {
    return this.admin.listDrivers(await this.effectiveBranch(userId, branchId));
  }

  @Get('drivers/:id')
  async getDriver(@CurrentUser('sub') userId: bigint, @Param('id') id: string) {
    await this.assertDriverInScope(userId, Number(id));
    return this.admin.getDriver(Number(id));
  }

  /** Historial de asignaciones cerradas del repartidor (más reciente primero). */
  @Get('drivers/:id/history')
  async driverHistory(
    @CurrentUser('sub') userId: bigint,
    @Param('id') id: string,
  ) {
    await this.assertDriverInScope(userId, Number(id));
    return this.admin.listDriverHistory(Number(id));
  }

  /** Crea la cuenta de acceso + perfil de repartidor (loguea en la app móvil). */
  @Post('drivers')
  @HttpCode(HttpStatus.CREATED)
  async createDriver(
    @CurrentUser('sub') userId: bigint,
    @Body() dto: CreateDriverDto,
  ) {
    const scope = await this.scope(userId);
    // El admin de sucursal crea siempre repartidores en su sucursal.
    const effective = scope != null ? { ...dto, branchId: scope } : dto;
    return this.admin.createDriver(effective);
  }

  @Put('drivers/:id')
  async updateDriver(
    @CurrentUser('sub') userId: bigint,
    @Param('id') id: string,
    @Body() dto: UpdateDriverDto,
  ) {
    await this.assertDriverInScope(userId, Number(id));
    const scope = await this.scope(userId);
    // El admin de sucursal no puede sacar al repartidor de su sucursal.
    const effective = scope != null ? { ...dto, branchId: scope } : dto;
    return this.admin.updateDriver(Number(id), effective);
  }

  @Post('drivers/:id/reset-password')
  async resetPassword(
    @CurrentUser('sub') userId: bigint,
    @Param('id') id: string,
    @Body() dto: ResetPasswordDto,
  ) {
    await this.assertDriverInScope(userId, Number(id));
    return this.admin.resetPassword(Number(id), dto.password);
  }

  // ─── Chat repartidor ↔ admin ────────────────────────────────────────────────

  /** Bandeja: un renglón por repartidor con no leídos y último mensaje. */
  @Get('chats')
  listChats() {
    return this.chat.listConversations();
  }

  /** Hilo de un repartidor. Al abrirlo se marca lo recibido como leído. */
  @Get('drivers/:id/messages')
  chatMessages(@Param('id') id: string) {
    return this.chat.listMessages(Number(id), 'admin');
  }

  /** Envía un mensaje del administrador al repartidor. */
  @Post('drivers/:id/messages')
  @HttpCode(HttpStatus.CREATED)
  sendChatMessage(
    @CurrentUser('sub') userId: bigint,
    @Param('id') id: string,
    @Body() dto: SendMessageDto,
  ) {
    return this.chat.sendFromAdmin(Number(id), Number(userId), dto.body);
  }

  /** Pedidos de la flota (todos los estados), paginados para la pestaña. */
  @Get('orders')
  async listOrders(
    @CurrentUser('sub') userId: bigint,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('status') status?: string,
    @Query('q') q?: string,
    @Query('branchId') branchId?: string,
  ) {
    return this.admin.listOrders({
      limit: limit != null ? Number(limit) : undefined,
      offset: offset != null ? Number(offset) : undefined,
      status,
      q,
      branchId: await this.effectiveBranch(userId, branchId),
    });
  }

  /**
   * Ruta por calles (OSRM) del pedido, para pintarla en el mapa de flota.
   * `target` = 'store' | 'customer'; `from` opcional (`lng,lat`) para rutas
   * que no parten del repartidor (p. ej. tienda → domicilio).
   */
  @Get('orders/:id/route')
  getOrderRoute(
    @Param('id') id: string,
    @Query('target') target?: string,
    @Query('from') from?: string,
  ) {
    return this.admin.getOrderRoute(
      Number(id),
      target === 'store' ? 'store' : 'customer',
      from,
    );
  }
}
