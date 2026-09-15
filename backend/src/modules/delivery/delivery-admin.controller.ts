import {
  Body,
  Controller,
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
 */
@Controller('delivery/admin')
@UseGuards(JwtAuthGuard, SuperuserGuard)
export class DeliveryAdminController {
  constructor(
    private readonly admin: DeliveryAdminService,
    private readonly chat: DriverChatService,
  ) {}

  /** Flota completa con posición y pedido activo de cada repartidor. */
  @Get('drivers')
  listDrivers() {
    return this.admin.listDrivers();
  }

  @Get('drivers/:id')
  getDriver(@Param('id') id: string) {
    return this.admin.getDriver(Number(id));
  }

  /** Crea la cuenta de acceso + perfil de repartidor (loguea en la app móvil). */
  @Post('drivers')
  @HttpCode(HttpStatus.CREATED)
  createDriver(@Body() dto: CreateDriverDto) {
    return this.admin.createDriver(dto);
  }

  @Put('drivers/:id')
  updateDriver(@Param('id') id: string, @Body() dto: UpdateDriverDto) {
    return this.admin.updateDriver(Number(id), dto);
  }

  @Post('drivers/:id/reset-password')
  resetPassword(@Param('id') id: string, @Body() dto: ResetPasswordDto) {
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

  /** Pedidos activos de toda la flota. */
  @Get('orders')
  listOrders() {
    return this.admin.listOrders();
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
