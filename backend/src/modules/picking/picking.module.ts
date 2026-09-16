import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { OrdersModule } from '../orders/orders.module';
import { DeliveryModule } from '../delivery/delivery.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PickingController } from './picking.controller';
import { PickingGateway } from './picking.gateway';
import { PickingService } from './picking.service';
import { PickerChatService } from './picker-chat.service';

@Module({
  imports: [AuthModule, OrdersModule, DeliveryModule, NotificationsModule],
  controllers: [PickingController],
  providers: [PickingService, PickingGateway, PickerChatService],
  exports: [PickingService, PickerChatService],
})
export class PickingModule {}
