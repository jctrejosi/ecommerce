import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { OrdersModule } from '../orders/orders.module';
import { DeliveryAuthController } from './delivery-auth.controller';
import { DeliveryAuthService } from './delivery-auth.service';
import { DeliveryController } from './delivery.controller';
import { DeliveryService } from './delivery.service';
import { DeliveryGateway } from './delivery.gateway';
import { DeliveryOrdersController } from './delivery-orders.controller';
import { DeliveryOrdersService } from './delivery-orders.service';
import { DeliveryAdminController } from './delivery-admin.controller';
import { DeliveryAdminService } from './delivery-admin.service';
import { DriverChatService } from './driver-chat.service';
import { SuperuserGuard } from './superuser.guard';

@Module({
  imports: [AuthModule, NotificationsModule, OrdersModule],
  controllers: [
    DeliveryAuthController,
    DeliveryController,
    DeliveryOrdersController,
    DeliveryAdminController,
  ],
  providers: [
    DeliveryAuthService,
    DeliveryService,
    DeliveryOrdersService,
    DeliveryAdminService,
    DriverChatService,
    DeliveryGateway,
    SuperuserGuard,
  ],
  exports: [DeliveryOrdersService, DeliveryGateway],
})
export class DeliveryModule {}
