import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SuperuserGuard } from '../delivery/superuser.guard';
import { ShelvesController } from './shelves.controller';
import { ShelvesService } from './shelves.service';

@Module({
  imports: [AuthModule],
  controllers: [ShelvesController],
  providers: [ShelvesService, SuperuserGuard],
  exports: [ShelvesService],
})
export class ShelvesModule {}
