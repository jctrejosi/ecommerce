import {
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

/** DTO para crear un repartidor (usuario de acceso + perfil de repartidor). */
export class CreateDriverDto {
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

  @IsString()
  @MinLength(6)
  @MaxLength(50)
  phone!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(100)
  password!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  firstName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  lastName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  vehicleType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  vehiclePlate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  vehicleBrand?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  vehicleModel?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  vehicleColor?: string;
}

/** DTO para actualizar un repartidor. Todos los campos son opcionales. */
export class UpdateDriverDto {
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
  @MinLength(6)
  @MaxLength(50)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  firstName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  lastName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  vehicleType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  vehiclePlate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  vehicleBrand?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  vehicleModel?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  vehicleColor?: string;

  @IsOptional()
  @IsBoolean()
  isAvailable?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  /** Color (#RRGGBB) con el que se pinta la ruta del repartidor en el mapa. */
  @IsOptional()
  @Matches(/^#[0-9a-fA-F]{6}$/, {
    message: 'routeColor debe ser un color hexadecimal (#RRGGBB).',
  })
  routeColor?: string;
}

export class ResetPasswordDto {
  @IsString()
  @MinLength(8)
  @MaxLength(100)
  password!: string;
}
