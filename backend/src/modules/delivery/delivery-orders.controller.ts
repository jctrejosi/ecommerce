import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { DeliveryAuthService } from './delivery-auth.service';
import { DeliveryService } from './delivery.service';
import { DeliveryOrdersService } from './delivery-orders.service';
import { TransitionDto } from './dto/transition.dto';
import { AvailabilityDto } from './dto/availability.dto';
import { PushTokenDto } from './dto/push-token.dto';

@Controller('delivery')
@UseGuards(JwtAuthGuard)
export class DeliveryOrdersController {
  constructor(
    private readonly delivery: DeliveryService,
    private readonly orders: DeliveryOrdersService,
    private readonly auth: DeliveryAuthService,
  ) {}

  @Get('orders')
  list(@CurrentUser('sub') userId: bigint) {
    return this.delivery.resolveDriver(Number(userId)).then((driver) =>
      this.orders.listActive(Number(driver.id)),
    );
  }

  @Get('orders/:id')
  get(@CurrentUser('sub') userId: bigint, @Param('id') id: string) {
    return this.delivery.resolveDriver(Number(userId)).then((driver) =>
      this.orders.getOrder(Number(driver.id), Number(id)),
    );
  }

  @Post('orders/:id/:action')
  transition(
    @CurrentUser('sub') userId: bigint,
    @Param('id') id: string,
    @Param('action') action: string,
    @Body() payload: TransitionDto,
  ) {
    return this.delivery.resolveDriver(Number(userId)).then((driver) =>
      this.orders.transition(Number(driver.id), Number(id), action, payload),
    );
  }

  @Get('history')
  history(@CurrentUser('sub') userId: bigint) {
    return this.delivery.resolveDriver(Number(userId)).then((driver) =>
      this.orders.history(Number(driver.id)),
    );
  }

  @Put('profile/availability')
  availability(@CurrentUser('sub') userId: bigint, @Body() dto: AvailabilityDto) {
    return this.delivery.resolveDriver(Number(userId)).then(async (driver) => {
      await this.orders.setAvailability(Number(driver.id), dto.isAvailable);
      return this.auth.me(Number(userId));
    });
  }

  @Put('profile/push-token')
  pushToken(@CurrentUser('sub') userId: bigint, @Body() dto: PushTokenDto) {
    return this.delivery.resolveDriver(Number(userId)).then((driver) =>
      this.orders.setPushToken(Number(driver.id), dto.token),
    );
  }
}
