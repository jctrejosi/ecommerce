import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../../common/guards/optional-jwt-auth.guard';
import { BranchScopeService } from '../../common/branch-scope/branch-scope.service';
import { SuperuserGuard } from '../delivery/superuser.guard';
import { SendPickerMessageDto } from '../picking/dto/send-picker-message.dto';
import { PickerChatService } from '../picking/picker-chat.service';
import { PickerBreakService, type BreakSettings } from '../picking/picker-break.service';
import {
  CreatePickerDto,
  ResetPickerPasswordDto,
  UpdatePickerDto,
} from './dto/picker.dto';
import { PickersService } from './pickers.service';

/**
 * Admin de picking.
 *
 * El **admin de sucursal** (superusuario con sucursal) queda forzado a su
 * sucursal en pedidos, métricas, usuarios y pickers; el **admin global**
 * (superusuario sin sucursal) ve todo. Las rutas públicas usan auth opcional
 * para no romper a la app móvil.
 */
@ApiTags('Picking Admin')
@Controller('picking-admin')
export class PickersController {
  constructor(
    private readonly pickersService: PickersService,
    private readonly chat: PickerChatService,
    private readonly branchScope: BranchScopeService,
    private readonly breaks: PickerBreakService,
  ) {}

  private scope(userId: bigint | null): Promise<number | null> {
    return this.branchScope.scopeOf(userId != null ? Number(userId) : null);
  }

  @Get('pickers')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({ summary: 'Usuarios disponibles para picking (selector de picker)' })
  async list(@CurrentUser('sub') userId: bigint | null) {
    const scope = await this.scope(userId);
    return this.pickersService.list(scope);
  }

  // ─── Gestión de usuarios (solo administradores) ────────────────────────────

  @Get('users')
  @UseGuards(JwtAuthGuard, SuperuserGuard)
  @ApiOperation({ summary: 'Usuarios de picking (incluye inactivos)' })
  async listUsers(
    @CurrentUser('sub') userId: bigint,
    @Query('branchId') branchId?: string,
  ) {
    const scope = await this.scope(userId);
    // El admin de sucursal queda forzado a la suya; el global filtra por la
    // sucursal seleccionada en el panel (o todas si no viene).
    const parsed = branchId ? Number.parseInt(branchId, 10) : NaN;
    const effective = scope ?? (Number.isInteger(parsed) ? parsed : null);
    return this.pickersService.listAll(effective);
  }

  @Post('users')
  @HttpCode(201)
  @UseGuards(JwtAuthGuard, SuperuserGuard)
  @ApiOperation({ summary: 'Crea un usuario de picking' })
  async createUser(
    @CurrentUser('sub') userId: bigint,
    @Body() dto: CreatePickerDto,
  ) {
    const scope = await this.scope(userId);
    // El admin de sucursal crea siempre usuarios en su sucursal.
    const effective =
      scope != null ? { ...dto, branchId: scope } : dto;
    return this.pickersService.create(effective);
  }

  @Put('users/:id')
  @UseGuards(JwtAuthGuard, SuperuserGuard)
  @ApiOperation({ summary: 'Actualiza un usuario de picking' })
  async updateUser(
    @CurrentUser('sub') actingUserId: bigint,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdatePickerDto,
  ) {
    const scope = await this.scope(actingUserId);
    if (scope != null) {
      const target = await this.branchScope.userBranch(id);
      if (target !== scope) {
        throw new ForbiddenException('Ese usuario no pertenece a tu sucursal');
      }
      // No puede sacar usuarios de su sucursal.
      dto = { ...dto, branchId: scope };
    }
    return this.pickersService.update(id, dto, Number(actingUserId));
  }

  @Post('users/:id/reset-password')
  @UseGuards(JwtAuthGuard, SuperuserGuard)
  @ApiOperation({ summary: 'Restablece la contraseña de un usuario de picking' })
  async resetUserPassword(
    @CurrentUser('sub') actingUserId: bigint,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ResetPickerPasswordDto,
  ) {
    const scope = await this.scope(actingUserId);
    if (scope != null) {
      const target = await this.branchScope.userBranch(id);
      if (target !== scope) {
        throw new ForbiddenException('Ese usuario no pertenece a tu sucursal');
      }
    }
    return this.pickersService.resetPassword(id, dto.password);
  }

  @Get('metrics')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({
    summary: 'Métricas de los pickers: pedido actual, entregados hoy y total despachado',
  })
  async metrics(@CurrentUser('sub') userId: bigint | null) {
    const scope = await this.scope(userId);
    return this.pickersService.metrics(scope);
  }

  @Get('orders')
  @UseGuards(JwtAuthGuard, SuperuserGuard)
  @ApiOperation({ summary: 'Pedidos del panel, filtrables por sucursal' })
  @ApiQuery({ name: 'branchId', required: false, description: 'Sucursal; sin él, todas' })
  @ApiQuery({ name: 'status', required: false, description: 'Estado del pedido' })
  @ApiQuery({
    name: 'search',
    required: false,
    description: 'Buscar por referencia, cliente o teléfono',
  })
  @ApiQuery({ name: 'limit', required: false, description: 'Límite de resultados' })
  @ApiQuery({ name: 'offset', required: false, description: 'Offset de paginación' })
  async orders(
    @CurrentUser('sub') userId: bigint,
    @Query('branchId') branchId?: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const scope = await this.scope(userId);
    const parsedBranchId = branchId ? Number.parseInt(branchId, 10) : NaN;
    const parsedLimit = limit ? Number.parseInt(limit, 10) : NaN;
    const parsedOffset = offset ? Number.parseInt(offset, 10) : NaN;
    // El admin de sucursal solo ve su sucursal, ignore lo que pida la URL.
    const effectiveBranchId =
      scope ??
      (Number.isInteger(parsedBranchId) && parsedBranchId > 0
        ? parsedBranchId
        : undefined);
    return this.pickersService.orderList({
      branchId: effectiveBranchId,
      status,
      search,
      limit: Number.isInteger(parsedLimit) ? parsedLimit : undefined,
      offset: Number.isInteger(parsedOffset) ? parsedOffset : undefined,
    });
  }

  @Get('pickers/:id/history')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({ summary: 'Historial completo de pedidos despachados por un picker' })
  async history(
    @CurrentUser('sub') userId: bigint | null,
    @Param('id', ParseIntPipe) id: number,
  ) {
    if (!Number.isInteger(id) || id <= 0) {
      throw new BadRequestException('id inválido');
    }
    const scope = await this.scope(userId);
    if (scope != null) {
      const target = await this.branchScope.userBranch(id);
      if (target !== scope) {
        throw new ForbiddenException('Ese picker no pertenece a tu sucursal');
      }
    }
    return this.pickersService.history(id);
  }

  // ─── Configuración de descansos y metas ────────────────────────────────────

  @Get('settings')
  @UseGuards(JwtAuthGuard, SuperuserGuard)
  @ApiOperation({ summary: 'Configuración de descansos, metas y bono del picking' })
  async getBreakSettings() {
    return this.breaks.getSettings();
  }

  @Put('settings')
  @UseGuards(JwtAuthGuard, SuperuserGuard)
  @ApiOperation({ summary: 'Actualizar la configuración de descansos y metas' })
  async updateBreakSettings(@Body() body: Partial<BreakSettings>) {
    return this.breaks.updateSettings(body);
  }

  // ─── Chat con los pickers ──────────────────────────────────────────────────

  /** Bandeja: un renglón por picker con no leídos y último mensaje. */
  @Get('chats')
  @UseGuards(JwtAuthGuard, SuperuserGuard)
  @ApiOperation({ summary: 'Bandeja del chat con los pickers' })
  async listChats(@CurrentUser('sub') userId: bigint) {
    const scope = await this.scope(userId);
    return this.chat.listConversations(scope);
  }

  /** Hilo de un picker. Al abrirlo se marca como leído lo que escribió él. */
  @Get('pickers/:id/messages')
  @UseGuards(JwtAuthGuard, SuperuserGuard)
  @ApiOperation({ summary: 'Mensajes del chat con un picker' })
  async chatMessages(
    @CurrentUser('sub') userId: bigint,
    @Param('id', ParseIntPipe) id: number,
  ) {
    await this.assertPickerInScope(userId, id);
    return this.chat.listMessages(id, 'admin');
  }

  /** Envía un mensaje del administrador al picker. */
  @Post('pickers/:id/messages')
  @HttpCode(201)
  @UseGuards(JwtAuthGuard, SuperuserGuard)
  @ApiOperation({ summary: 'Enviar mensaje a un picker' })
  async sendChatMessage(
    @CurrentUser('sub') userId: bigint,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SendPickerMessageDto,
  ) {
    await this.assertPickerInScope(userId, id);
    return this.chat.sendFromAdmin(id, Number(userId), dto.body);
  }

  /** Un admin de sucursal solo accede a pickers de su sucursal. */
  private async assertPickerInScope(userId: bigint, pickerId: number) {
    const scope = await this.scope(userId);
    if (scope == null) return;
    const target = await this.branchScope.userBranch(pickerId);
    if (target !== scope) {
      throw new ForbiddenException('Ese picker no pertenece a tu sucursal');
    }
  }
}
