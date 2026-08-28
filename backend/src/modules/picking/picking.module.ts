import { Module } from '@nestjs/common';
import { PickingController } from './picking.controller';
import { PickingGateway } from './picking.gateway';
import { PickingService } from './picking.service';

@Module({
  controllers: [PickingController],
  providers: [PickingService, PickingGateway],
  exports: [PickingService],
})
export class PickingModule {}
