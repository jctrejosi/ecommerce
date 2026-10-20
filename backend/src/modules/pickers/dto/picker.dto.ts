import {
  IsBoolean,
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

/** Crea el usuario de picking (cuenta de acceso a la app móvil). */
export class CreatePickerDto {
  @IsString()
  @MinLength(3)
  @MaxLength(100)
  fullName!: string;

  @IsString()
  @MinLength(3)
  @MaxLength(50)
  username!: string;

  @IsEmail()
  email!: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  phone?: string;

  @IsString()
  @MinLength(8)
  @MaxLength(100)
  password!: string;

  /** Sucursal asignada (una sola). Opcional: puede quedar sin asignar. */
  @IsOptional()
  @IsInt()
  branchId?: number | null;

  /** Crear como administrador (superusuario). */
  @IsOptional()
  @IsBoolean()
  isSuperuser?: boolean;
}

/** Actualiza un usuario de picking. Todos los campos son opcionales. */
export class UpdatePickerDto {
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(100)
  fullName?: string;

  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(50)
  username?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  phone?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsBoolean()
  isPicker?: boolean;

  /** Sucursal asignada (una sola). null la quita. */
  @IsOptional()
  @IsInt()
  branchId?: number | null;

  /** Marcar/quitar como administrador (superusuario). */
  @IsOptional()
  @IsBoolean()
  isSuperuser?: boolean;
}

/** Restablece la contraseña de un usuario de picking. */
export class ResetPickerPasswordDto {
  @IsString()
  @MinLength(8)
  @MaxLength(100)
  password!: string;
}
