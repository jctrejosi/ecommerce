import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CloudinaryModule } from '../cloudinary/cloudinary.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { OrdersModule } from '../orders/orders.module';
import { DeliveryAuthController } from './delivery-auth.controller';
import { DeliveryAuthService } from './delivery-auth.service';
import { DeliveryController } from './delivery.controller';
import { DeliveryLoadService } from './delivery-load.service';
import { DeliveryService } from './delivery.service';
import { DeliveryGateway } from './delivery.gateway';
import { DeliveryOrdersController } from './delivery-orders.controller';
import { DeliveryOrdersService } from './delivery-orders.service';
import { DeliveryAdminController } from './delivery-admin.controller';
import { DeliveryAdminService } from './delivery-admin.service';
import { DriverChatService } from './driver-chat.service';
import { SuperuserGuard } from './superuser.guard';

@Module({
  imports: [AuthModule, NotificationsModule, OrdersModule, CloudinaryModule],
  controllers: [
    DeliveryAuthController,
    DeliveryController,
    DeliveryOrdersController,
    DeliveryAdminController,
  ],
  providers: [
    DeliveryAuthService,
    DeliveryLoadService,
    DeliveryService,
    DeliveryOrdersService,
    DeliveryAdminService,
    DriverChatService,
    DeliveryGateway,
    SuperuserGuard,
  ],
  exports: [DeliveryOrdersService, DeliveryLoadService, DeliveryGateway],
})
export class DeliveryModule {}
