import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SuperuserGuard } from '../delivery/superuser.guard';
import { PickersController } from './pickers.controller';
import { PickersService } from './pickers.service';

@Module({
  imports: [AuthModule],
  controllers: [PickersController],
  providers: [PickersService, SuperuserGuard],
  exports: [PickersService],
})
export class PickersModule {}
