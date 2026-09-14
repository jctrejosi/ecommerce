import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { SuperuserGuard } from '../delivery/superuser.guard';
import {
  CreatePickerDto,
  ResetPickerPasswordDto,
  UpdatePickerDto,
} from './dto/picker.dto';
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

  // ─── Gestión de usuarios (solo administradores) ────────────────────────────

  @Get('users')
  @UseGuards(JwtAuthGuard, SuperuserGuard)
  @ApiOperation({ summary: 'Usuarios de picking (incluye inactivos)' })
  listUsers() {
    return this.pickersService.listAll();
  }

  @Post('users')
  @HttpCode(201)
  @UseGuards(JwtAuthGuard, SuperuserGuard)
  @ApiOperation({ summary: 'Crea un usuario de picking' })
  createUser(@Body() dto: CreatePickerDto) {
    return this.pickersService.create(dto);
  }

  @Put('users/:id')
  @UseGuards(JwtAuthGuard, SuperuserGuard)
  @ApiOperation({ summary: 'Actualiza un usuario de picking' })
  updateUser(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdatePickerDto,
  ) {
    return this.pickersService.update(id, dto);
  }

  @Post('users/:id/reset-password')
  @UseGuards(JwtAuthGuard, SuperuserGuard)
  @ApiOperation({ summary: 'Restablece la contraseña de un usuario de picking' })
  resetUserPassword(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ResetPickerPasswordDto,
  ) {
    return this.pickersService.resetPassword(id, dto.password);
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
