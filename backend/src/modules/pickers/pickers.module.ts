import { Module } from '@nestjs/common';
import { PickersController } from './pickers.controller';
import { PickersService } from './pickers.service';

@Module({
  controllers: [PickersController],
  providers: [PickersService],
  exports: [PickersService],
})
export class PickersModule {}
