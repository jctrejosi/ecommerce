import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { ChangeOwnPasswordDto } from './dto/change-password.dto';
import { PickersService } from './pickers.service';

/**
 * Perfil del picker autenticado (app móvil): su propia contraseña y su foto.
 *
 * A propósito NO lleva `SuperuserGuard`: cada picker administra lo suyo. Lo que
 * sí exige el cambio de contraseña es la contraseña actual, porque el
 * dispositivo queda en la bodega y sin ese control cualquiera podría cambiarla
 * desde la app abierta.
 */
@ApiTags('Picking')
@Controller('picking/profile')
export class PickerProfileController {
  constructor(
    private readonly pickers: PickersService,
    private readonly cloudinary: CloudinaryService,
  ) {}

  @Post('password')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Cambiar la contraseña del picker autenticado' })
  changePassword(
    @CurrentUser('sub') userId: bigint,
    @Body() dto: ChangeOwnPasswordDto,
  ) {
    return this.pickers.changeOwnPassword(
      Number(userId),
      dto.currentPassword,
      dto.newPassword,
    );
  }

  @Post('avatar')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Subir la foto de perfil del picker autenticado' })
  async uploadAvatar(
    @CurrentUser('sub') userId: bigint,
    @UploadedFile() file: { buffer: Buffer; originalname?: string } | undefined,
  ) {
    if (!file?.buffer) throw new BadRequestException('Archivo requerido');

    const id = Number(userId);
    // La URL se guarda en `users.avatar_url`: es la misma foto que muestra el
    // panel de picking admin.
    const { url } = await this.cloudinary.uploadImage(file, `user_${id}`, {
      folder: `picking/users/${id}`,
      // Avatar cuadrado y ligero (en una foto, lossless pesa demasiado).
      resize: 512,
      lossless: false,
    });

    return this.pickers.setAvatarUrl(id, url);
  }
}
