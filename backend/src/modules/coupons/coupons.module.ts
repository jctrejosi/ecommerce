import { Module } from '@nestjs/common';
import { AdminCouponsController } from './admin-coupons.controller';
import { PublicCouponsController } from './public-coupons.controller';
import { CouponsService } from './coupons.service';

@Module({
  controllers: [AdminCouponsController, PublicCouponsController],
  providers: [CouponsService],
  exports: [CouponsService],
})
export class CouponsModule {}
