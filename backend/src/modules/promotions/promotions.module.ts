import { Module } from '@nestjs/common';
import { AdminPromotionsController } from './admin-promotions.controller';
import { PromotionsService } from './promotions.service';
import { PromotionEngineService } from './promotion-engine.service';

@Module({
  controllers: [AdminPromotionsController],
  providers: [PromotionsService, PromotionEngineService],
  exports: [PromotionsService, PromotionEngineService],
})
export class PromotionsModule {}
