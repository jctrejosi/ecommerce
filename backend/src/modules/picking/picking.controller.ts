import {
  BadRequestException,
  ConflictException,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Body,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PickingService } from './picking.service';

@ApiTags('Picking')
@Controller('picking')
export class PickingController {
  constructor(private readonly pickingService: PickingService) {}

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
}
