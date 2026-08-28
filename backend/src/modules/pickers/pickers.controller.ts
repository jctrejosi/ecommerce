import {
  BadRequestException,
  Controller,
  Get,
  Param,
  ParseIntPipe,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PickersService } from './pickers.service';

@ApiTags('Picking Admin')
@Controller('picking-admin')
export class PickersController {
  constructor(private readonly pickersService: PickersService) {}

  @Get('pickers')
  @ApiOperation({ summary: 'Usuarios disponibles para picking (selector de picker)' })
  list() {
    return this.pickersService.list();
  }

  @Get('metrics')
  @ApiOperation({
    summary: 'Métricas de los pickers: pedido actual, entregados hoy y total despachado',
  })
  metrics() {
    return this.pickersService.metrics();
  }

  @Get('pickers/:id/history')
  @ApiOperation({ summary: 'Historial completo de pedidos despachados por un picker' })
  history(@Param('id', ParseIntPipe) id: number) {
    if (!Number.isInteger(id) || id <= 0) {
      throw new BadRequestException('id inválido');
    }
    return this.pickersService.history(id);
  }
}
