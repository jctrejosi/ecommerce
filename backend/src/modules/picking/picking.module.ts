import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { OrdersModule } from '../orders/orders.module';
import { DeliveryModule } from '../delivery/delivery.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PickerQueueModule } from './picker-queue.module';
import { PickingController } from './picking.controller';
import { PickingGateway } from './picking.gateway';
import { PickingService } from './picking.service';
import { PickerChatService } from './picker-chat.service';
import { PickerBreakService } from './picker-break.service';

@Module({
  imports: [AuthModule, OrdersModule, DeliveryModule, NotificationsModule, PickerQueueModule],
  controllers: [PickingController],
  providers: [PickingService, PickingGateway, PickerChatService, PickerBreakService],
  exports: [PickingService, PickerChatService, PickerBreakService],
})
export class PickingModule {}
