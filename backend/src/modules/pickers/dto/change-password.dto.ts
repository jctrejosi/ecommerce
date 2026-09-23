import { IsString, MaxLength, MinLength } from 'class-validator';

/** Cambio de contraseña del propio picker (app móvil). */
export class ChangeOwnPasswordDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  currentPassword!: string;

  /** Mismo mínimo que el panel (alta y reset de usuarios). */
  @IsString()
  @MinLength(8)
  @MaxLength(100)
  newPassword!: string;
}
