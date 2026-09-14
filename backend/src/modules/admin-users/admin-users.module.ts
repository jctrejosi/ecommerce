import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SuperuserGuard } from '../delivery/superuser.guard';
import { AdminUsersController } from './admin-users.controller';
import { AdminUsersService } from './admin-users.service';

@Module({
  imports: [AuthModule],
  controllers: [AdminUsersController],
  providers: [AdminUsersService, SuperuserGuard],
  exports: [AdminUsersService],
})
export class AdminUsersModule {}
