import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module';
import { DeliveryModule } from '../delivery/delivery.module';
import { PickingController } from './picking.controller';
import { PickingGateway } from './picking.gateway';
import { PickingService } from './picking.service';

@Module({
  imports: [OrdersModule, DeliveryModule],
  controllers: [PickingController],
  providers: [PickingService, PickingGateway],
  exports: [PickingService],
})
export class PickingModule {}
