import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export enum CouponKind {
  DISCOUNT = 'discount',
  BALANCE = 'balance',
  MIXED = 'mixed',
}

export enum CouponDiscountType {
  PERCENTAGE = 'percentage',
  FIXED = 'fixed',
}

export class IssueCouponDto {
  @ApiPropertyOptional({
    description:
      'Código manual. Si se omite se genera automáticamente (recomendado).',
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  code?: string;

  @ApiPropertyOptional({ enum: CouponKind })
  @IsOptional()
  @IsEnum(CouponKind)
  kind?: CouponKind;

  @ApiPropertyOptional({ description: 'ID de promoción a la que se asocia' })
  @IsOptional()
  @IsInt()
  promotionId?: number;

  @ApiPropertyOptional({ enum: CouponDiscountType })
  @IsOptional()
  @IsEnum(CouponDiscountType)
  discountType?: CouponDiscountType;

  @ApiPropertyOptional({ description: 'Valor del descuento (% o monto fijo)' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  discountValue?: number;

  @ApiPropertyOptional({ description: 'Tope del descuento en dinero' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  maximumDiscount?: number;

  @ApiPropertyOptional({ description: 'Saldo inicial del cupón' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  initialBalance?: number;

  @ApiPropertyOptional({ description: 'Inicio de vigencia' })
  @IsOptional()
  @IsDateString()
  startsAt?: string;

  @ApiPropertyOptional({ description: 'Vencimiento' })
  @IsOptional()
  @IsDateString()
  expiresAt?: string;

  @ApiPropertyOptional({ description: 'Máximo de usos (descuento)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  maxUsesTotal?: number;

  @ApiPropertyOptional({ description: 'Máximo de usos por cliente' })
  @IsOptional()
  @IsInt()
  @Min(1)
  maxUsesPerCustomer?: number;

  @ApiPropertyOptional({ description: 'Cliente al que se emite (opcional)' })
  @IsOptional()
  @IsInt()
  issuedCustomerId?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({
    description: 'Cantidad de cupones a emitir en lote (mismo valores)',
    default: 1,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  quantity?: number;
}

export class UpdateCouponDto {
  @ApiPropertyOptional({ description: 'Bloquear / desbloquear' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ description: 'Estado: active | blocked | expired' })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ description: 'Nuevo vencimiento' })
  @IsOptional()
  @IsDateString()
  expiresAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  maxUsesTotal?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  maxUsesPerCustomer?: number;

  @ApiPropertyOptional({ description: 'Cliente al que se emite' })
  @IsOptional()
  @IsInt()
  issuedCustomerId?: number;
}

export class QueryCouponsDto {
  @ApiPropertyOptional({
    description: 'active | exhausted | expired | blocked',
  })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ description: 'discount | balance | mixed' })
  @IsOptional()
  @IsString()
  kind?: string;

  @ApiPropertyOptional({ description: 'Buscar por código o nota' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  limit?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  offset?: string;
}

export class ValidateCouponDto {
  @ApiPropertyOptional({ description: 'Código del cupón' })
  @IsString()
  code: string;

  @ApiPropertyOptional({
    description: 'Subtotal del carrito para estimar descuento',
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  subtotal?: number;
}
