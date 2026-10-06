import {
  IsBoolean,
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
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

  /**
   * Capacidad de carga del vehículo en cm³ (1 L = 1.000 cm³). Sin declarar, no
   * se le puede validar el cupo al asignarle pedidos.
   */
  @IsOptional()
  @IsInt()
  @Min(1000)
  @Max(100_000_000)
  cargoVolumeCm3?: number;

  /**
   * Sucursal asignada (una sola). Opcional. El admin de sucursal siempre la
   * fuerza a la suya; el admin global puede elegir cualquiera (o ninguna).
   */
  @IsOptional()
  @IsInt()
  branchId?: number | null;
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

  /**
   * Capacidad de carga del vehículo en cm³. `null` la borra (queda sin
   * capacidad declarada); omitirla deja el valor actual.
   */
  @IsOptional()
  @IsInt()
  @Min(1000)
  @Max(100_000_000)
  cargoVolumeCm3?: number | null;

  /** Sucursal única: `null` la quita; omitirla deja la actual. */
  @IsOptional()
  @IsInt()
  branchId?: number | null;
}

export class ResetPasswordDto {
  @IsString()
  @MinLength(8)
  @MaxLength(100)
  password!: string;
}
