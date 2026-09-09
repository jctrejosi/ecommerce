import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { DeliveryAuthController } from './delivery-auth.controller';
import { DeliveryAuthService } from './delivery-auth.service';
import { DeliveryController } from './delivery.controller';
import { DeliveryService } from './delivery.service';
import { DeliveryGateway } from './delivery.gateway';
import { DeliveryOrdersController } from './delivery-orders.controller';
import { DeliveryOrdersService } from './delivery-orders.service';
import { DeliveryAdminController } from './delivery-admin.controller';
import { DeliveryAdminService } from './delivery-admin.service';
import { SuperuserGuard } from './superuser.guard';

@Module({
  imports: [AuthModule, NotificationsModule],
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
    DeliveryGateway,
    SuperuserGuard,
  ],
})
export class DeliveryModule {}
