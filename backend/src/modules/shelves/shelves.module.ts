import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SuperuserGuard } from '../delivery/superuser.guard';
import { BranchScopeService } from '../../common/branch-scope/branch-scope.service';
import { ShelvesController } from './shelves.controller';
import { ShelvesService } from './shelves.service';

@Module({
  imports: [AuthModule],
  controllers: [ShelvesController],
  providers: [ShelvesService, SuperuserGuard, BranchScopeService],
  exports: [ShelvesService],
})
export class ShelvesModule {}
