import { Module } from '@nestjs/common';
import { OrdersController } from './orders.controller';
import { AdminOrdersController } from './admin-orders.controller';
import { OrdersService } from './orders.service';
import { OrdersGateway } from './orders.gateway';
import { PaymentVerificationService } from './payment-verification.service';
import { WebhookController } from './webhook.controller';
import { PaymentsModule } from '../payments/payments.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PromotionsModule } from '../promotions/promotions.module';
import { CouponsModule } from '../coupons/coupons.module';
import { PickerQueueModule } from '../picking/picker-queue.module';

@Module({
  imports: [
    PaymentsModule,
    NotificationsModule,
    PromotionsModule,
    CouponsModule,
    PickerQueueModule,
  ],
  controllers: [OrdersController, AdminOrdersController, WebhookController],
  providers: [OrdersService, OrdersGateway, PaymentVerificationService],
  exports: [OrdersService, OrdersGateway],
})
export class OrdersModule {}
