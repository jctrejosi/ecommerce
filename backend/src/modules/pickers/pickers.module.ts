import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SuperuserGuard } from '../delivery/superuser.guard';
import { PickingModule } from '../picking/picking.module';
import { PickersController } from './pickers.controller';
import { PickersService } from './pickers.service';

@Module({
  // PickingModule aporta el PickerChatService (chat picker ↔ admin).
  imports: [AuthModule, PickingModule],
  controllers: [PickersController],
  providers: [PickersService, SuperuserGuard],
  exports: [PickersService],
})
export class PickersModule {}
