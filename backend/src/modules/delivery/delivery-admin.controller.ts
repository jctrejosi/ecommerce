import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { SuperuserGuard } from './superuser.guard';
import { DeliveryAdminService } from './delivery-admin.service';
import {
  CreateDriverDto,
  ResetPasswordDto,
  UpdateDriverDto,
} from './dto/admin-driver.dto';

/**
 * Endpoints administrativos del delivery (panel web delivery-admin).
 * Acceso solo para administradores (isSuperuser).
 */
@Controller('delivery/admin')
@UseGuards(JwtAuthGuard, SuperuserGuard)
export class DeliveryAdminController {
  constructor(private readonly admin: DeliveryAdminService) {}

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

  /** Pedidos activos de toda la flota. */
  @Get('orders')
  listOrders() {
    return this.admin.listOrders();
  }
}
