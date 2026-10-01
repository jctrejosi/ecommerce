import {
  BadRequestException,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Body,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { SendPickerMessageDto } from './dto/send-picker-message.dto';
import { PickerChatService } from './picker-chat.service';
import { PickingService } from './picking.service';

@ApiTags('Picking')
@Controller('picking')
export class PickingController {
  constructor(
    private readonly pickingService: PickingService,
    private readonly chat: PickerChatService,
  ) {}

  /** Cola de picking: pedidos que entran al alistamiento (o filtrados por estado). */
  @Get('orders')
  @ApiOperation({ summary: 'Cola de pedidos para picking (nuevo|preparando|completado|todos)' })
  async queue(@Query('status') status?: string) {
    return this.pickingService.queue(status);
  }

  @Get('orders/unreviewed-count')
  @ApiOperation({ summary: 'Cantidad de pedidos sin revisar en la cola' })
  async unreviewedCount() {
    return this.pickingService.unreviewedCount();
  }

  /** Historial del picker autenticado (pedidos que alistó), paginado de 10. */
  @Get('history')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Historial de pedidos alistados por el picker' })
  async history(@CurrentUser('sub') userId: bigint, @Query('offset') offset?: string) {
    const off = Math.max(0, Number(offset) || 0);
    return this.pickingService.history(Number(userId), off, 10);
  }

  @Get('orders/:id')
  @ApiOperation({ summary: 'Detalle de un pedido con sus items (barcode, PLU, cantidades)' })
  async detail(@Param('id', ParseIntPipe) id: number) {
    try {
      return await this.pickingService.detail(id);
    } catch (e) {
      if (e instanceof NotFoundException) throw e;
      throw new BadRequestException(e instanceof Error ? e.message : 'Error obteniendo el pedido');
    }
  }

  @Post('orders/:id/reviewed')
  @ApiOperation({ summary: 'Marcar pedido como revisado (reviewedAt)' })
  async markReviewed(@Param('id', ParseIntPipe) id: number) {
    return this.pickingService.markReviewed(id);
  }

  @Post('orders/:id/claim')
  @ApiOperation({ summary: 'Asignar el picker (usuario) que alista el pedido' })
  async claim(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { pickerId: number },
  ) {
    const pickerId = Number(body?.pickerId);
    if (!Number.isInteger(pickerId) || pickerId <= 0) {
      throw new BadRequestException('pickerId es obligatorio');
    }
    return this.pickingService.claim(id, pickerId);
  }

  /** Escaneo: valida barcode o PLU contra los items pendientes del pedido. */
  @Post('orders/:id/scan')
  @ApiOperation({ summary: 'Escanear un código (barcode o PLU) y alistar un item' })
  async scan(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { code: string },
  ) {
    const code = (body?.code ?? '').trim();
    if (!code) {
      throw new BadRequestException('El código escaneado está vacío');
    }
    try {
      return await this.pickingService.scan(id, code);
    } catch (e) {
      if (e instanceof NotFoundException || e instanceof ConflictException) throw e;
      throw new BadRequestException(e instanceof Error ? e.message : 'Error al escanear');
    }
  }

  /** Completar el alistamiento: "entregado en caja" → pedido entregado. */
  @Post('orders/:id/complete')
  @ApiOperation({ summary: 'Completar picking: entregado en caja' })
  async complete(@Param('id', ParseIntPipe) id: number) {
    try {
      return await this.pickingService.complete(id);
    } catch (e) {
      if (e instanceof NotFoundException || e instanceof ConflictException) throw e;
      throw new BadRequestException(e instanceof Error ? e.message : 'Error al completar');
    }
  }

  // ─── Chat con el panel (administración) ────────────────────────────────────

  /** Hilo del picker autenticado. Al abrirlo marca como leído lo del panel. */
  @Get('chat')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Mensajes del chat del picker con administración' })
  async chatMessages(@CurrentUser('sub') userId: bigint) {
    return this.chat.listMessages(Number(userId), 'picker');
  }

  /** No leídos + último mensaje (badge del header de la app). */
  @Get('chat/summary')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Resumen del chat del picker (no leídos)' })
  async chatSummary(@CurrentUser('sub') userId: bigint) {
    return this.chat.summary(Number(userId), 'picker');
  }

  /** Envía un mensaje del picker al panel. */
  @Post('chat')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Enviar mensaje del picker a administración' })
  async sendChatMessage(
    @CurrentUser('sub') userId: bigint,
    @Body() dto: SendPickerMessageDto,
  ) {
    return this.chat.sendFromPicker(Number(userId), dto.body);
  }
}
