import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

/** DTO para crear un usuario de panel (web admin / picking). */
export class CreateAdminUserDto {
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

  @IsOptional()
  @IsBoolean()
  isSuperuser?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  /** Marca al usuario como picker (puede iniciar sesión en la app de picking). */
  @IsOptional()
  @IsBoolean()
  isPicker?: boolean;

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  roleIds?: number[];
}

/** DTO para actualizar un usuario. Todos los campos son opcionales. */
export class UpdateAdminUserDto {
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
  isSuperuser?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsBoolean()
  isPicker?: boolean;

  /** Si se envía, reemplaza la asignación de roles del usuario. */
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  roleIds?: number[];
}

export class ResetAdminPasswordDto {
  @IsString()
  @MinLength(8)
  @MaxLength(100)
  password!: string;
}

export class CreateRoleDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}

export class UpdateRoleDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}

export class SetRolePermissionsDto {
  @IsArray()
  @IsString({ each: true })
  permissionCodes!: string[];
}
