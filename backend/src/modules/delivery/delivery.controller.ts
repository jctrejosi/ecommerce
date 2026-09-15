import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { DeliveryService } from './delivery.service';
import { DeliveryGateway } from './delivery.gateway';
import { LocationDto } from './dto/location.dto';

@Controller('delivery')
@UseGuards(JwtAuthGuard)
export class DeliveryController {
  constructor(
    private readonly delivery: DeliveryService,
    private readonly gateway: DeliveryGateway,
  ) {}

  @Post('location')
  async location(@CurrentUser('sub') userId: bigint, @Body() dto: LocationDto) {
    const driver = await this.delivery.getDriverByAuthUserId(Number(userId));
    if (!driver) {
      throw new UnauthorizedException('No hay repartidor asociado a esta cuenta.');
    }

    const result = await this.delivery.saveLocation(Number(driver.id), dto);
    this.gateway.emitDriverLocation(Number(driver.id), { lat: dto.lat, lng: dto.lng });
    return result;
  }

  /**
   * Señal de presencia sin GPS: la app la envía cada minuto mientras hay sesión,
   * incluso sin entregas, para que el panel distinga conectado de desconectado.
   */
  @Post('heartbeat')
  async heartbeat(@CurrentUser('sub') userId: bigint) {
    const driver = await this.delivery.getDriverByAuthUserId(Number(userId));
    if (!driver) {
      throw new UnauthorizedException('No hay repartidor asociado a esta cuenta.');
    }
    return this.delivery.touchLastSeen(Number(driver.id));
  }

  @Get('orders/:id/route')
  async route(
    @CurrentUser('sub') userId: bigint,
    @Param('id') id: string,
    @Query('from') from?: string,
    @Query('target') target?: string,
  ) {
    const driver = await this.delivery.getDriverByAuthUserId(Number(userId));
    if (!driver) {
      throw new UnauthorizedException('No hay repartidor asociado a esta cuenta.');
    }
    const routeTarget =
      target === 'store' ? 'store' : 'customer';
    return this.delivery.getOrderRoute(driver, Number(id), from, routeTarget);
  }
}
