import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CloudinaryModule } from '../cloudinary/cloudinary.module';
import { SuperuserGuard } from '../delivery/superuser.guard';
import { PickingModule } from '../picking/picking.module';
import { BranchScopeService } from '../../common/branch-scope/branch-scope.service';
import { PickerProfileController } from './picker-profile.controller';
import { PickersController } from './pickers.controller';
import { PickersService } from './pickers.service';

@Module({
  // PickingModule aporta el PickerChatService (chat picker ↔ admin).
  // CloudinaryModule, la subida de la foto de perfil del picker.
  imports: [AuthModule, PickingModule, CloudinaryModule],
  controllers: [PickersController, PickerProfileController],
  providers: [PickersService, SuperuserGuard, BranchScopeService],
  exports: [PickersService],
})
export class PickersModule {}
