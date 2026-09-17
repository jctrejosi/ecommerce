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
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { SuperuserGuard } from '../delivery/superuser.guard';
import { SendPickerMessageDto } from '../picking/dto/send-picker-message.dto';
import { PickerChatService } from '../picking/picker-chat.service';
import {
  CreatePickerDto,
  ResetPickerPasswordDto,
  UpdatePickerDto,
} from './dto/picker.dto';
import { PickersService } from './pickers.service';

@ApiTags('Picking Admin')
@Controller('picking-admin')
export class PickersController {
  constructor(
    private readonly pickersService: PickersService,
    private readonly chat: PickerChatService,
  ) {}

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
  orders(
    @Query('branchId') branchId?: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const parsedBranchId = branchId ? Number.parseInt(branchId, 10) : NaN;
    const parsedLimit = limit ? Number.parseInt(limit, 10) : NaN;
    const parsedOffset = offset ? Number.parseInt(offset, 10) : NaN;
    return this.pickersService.orderList({
      branchId:
        Number.isInteger(parsedBranchId) && parsedBranchId > 0
          ? parsedBranchId
          : undefined,
      status,
      search,
      limit: Number.isInteger(parsedLimit) ? parsedLimit : undefined,
      offset: Number.isInteger(parsedOffset) ? parsedOffset : undefined,
    });
  }

  @Get('pickers/:id/history')
  @ApiOperation({ summary: 'Historial completo de pedidos despachados por un picker' })
  history(@Param('id', ParseIntPipe) id: number) {
    if (!Number.isInteger(id) || id <= 0) {
      throw new BadRequestException('id inválido');
    }
    return this.pickersService.history(id);
  }

  // ─── Chat con los pickers ──────────────────────────────────────────────────

  /** Bandeja: un renglón por picker con no leídos y último mensaje. */
  @Get('chats')
  @UseGuards(JwtAuthGuard, SuperuserGuard)
  @ApiOperation({ summary: 'Bandeja del chat con los pickers' })
  listChats() {
    return this.chat.listConversations();
  }

  /** Hilo de un picker. Al abrirlo se marca como leído lo que escribió él. */
  @Get('pickers/:id/messages')
  @UseGuards(JwtAuthGuard, SuperuserGuard)
  @ApiOperation({ summary: 'Mensajes del chat con un picker' })
  chatMessages(@Param('id', ParseIntPipe) id: number) {
    return this.chat.listMessages(id, 'admin');
  }

  /** Envía un mensaje del administrador al picker. */
  @Post('pickers/:id/messages')
  @HttpCode(201)
  @UseGuards(JwtAuthGuard, SuperuserGuard)
  @ApiOperation({ summary: 'Enviar mensaje a un picker' })
  sendChatMessage(
    @CurrentUser('sub') userId: bigint,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SendPickerMessageDto,
  ) {
    return this.chat.sendFromAdmin(id, Number(userId), dto.body);
  }
}
