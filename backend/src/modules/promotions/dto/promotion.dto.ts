import {
  IsString,
  IsOptional,
  IsBoolean,
  IsInt,
  IsNumber,
  IsDateString,
  IsEnum,
  IsArray,
  Min,
  Max,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum DiscountType {
  PORCENTAJE = 'porcentaje',
  FIJO = 'fijo',
  CUPON = 'cupon',
}

export enum PromotionComboMode {
  SAME_DISCOUNT = 'same_discount',
  PER_PRODUCT = 'per_product',
}

/** Producto con descuento propio dentro de una promoción. */
export class PromotionProductDto {
  @ApiProperty({ description: 'ID del producto' })
  @IsInt()
  productId: number;

  @ApiPropertyOptional({
    description:
      'Descuento propio del producto. Si se omite, hereda el descuento general de la promoción.',
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  discountValue?: number;

  @ApiPropertyOptional({
    description: 'El descuento es porcentaje',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  isPercentage?: boolean;

  @ApiPropertyOptional({ description: 'Tope de descuento en dinero' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  maximumDiscount?: number;
}

/** Producto dentro de un combo. */
export class PromotionComboItemDto {
  @ApiProperty({ description: 'ID del producto' })
  @IsInt()
  productId: number;

  @ApiPropertyOptional({
    description: 'Descuento del producto. Solo se usa en modo "per_product".',
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  discountValue?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isPercentage?: boolean;
}

/**
 * Combo: conjunto de productos que deben llevarse juntos para que el
 * descuento aplique. `same_discount` aplica un único descuento a cada ítem;
 * `per_product` permite un descuento distinto por producto.
 */
export class PromotionComboDto {
  @ApiPropertyOptional({ description: 'Nombre del combo' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @ApiProperty({ enum: PromotionComboMode })
  @IsEnum(PromotionComboMode)
  mode: PromotionComboMode;

  @ApiPropertyOptional({
    description:
      'Cantidad de productos del combo que deben estar en el carrito. Por defecto, el total de ítems.',
    default: 2,
  })
  @IsOptional()
  @IsInt()
  @Min(2)
  quantityRequired?: number;

  @ApiPropertyOptional({
    description: 'Descuento para todos los ítems (modo same_discount)',
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  discountValue?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isPercentage?: boolean;

  @ApiProperty({ type: [PromotionComboItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PromotionComboItemDto)
  items: PromotionComboItemDto[];
}

export class CreatePromotionDto {
  @ApiProperty({
    description: 'Nombre de la promoción',
    example: 'Lunes de frutas',
  })
  @IsString()
  @MaxLength(100)
  name: string;

  @ApiPropertyOptional({ description: 'Descripción de la promoción' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ enum: DiscountType, description: 'Tipo de descuento' })
  @IsEnum(DiscountType)
  discountType: DiscountType;

  @ApiProperty({
    description: 'Valor del descuento base (porcentaje o monto fijo)',
    example: 15.5,
  })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  discountValue: number;

  @ApiPropertyOptional({ description: 'Tope de descuento en dinero' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  maximumDiscount?: number;

  @ApiPropertyOptional({
    description: 'Días de la semana (0=domingo … 6=sábado)',
  })
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  weekdays?: number[];

  @ApiPropertyOptional({
    description:
      'Categorías objetivo. Si se envían categorías, productos o combos, la promoción solo aplica a ellos.',
    type: [Number],
  })
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  categoryIds?: number[];

  @ApiPropertyOptional({ type: [Number] })
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  branchIds?: number[];

  @ApiPropertyOptional({ type: [PromotionProductDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PromotionProductDto)
  products?: PromotionProductDto[];

  @ApiPropertyOptional({ type: [PromotionComboDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PromotionComboDto)
  combos?: PromotionComboDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  couponCode?: string;

  @ApiPropertyOptional({ description: 'Máximo de usos totales del cupón' })
  @IsOptional()
  @IsInt()
  @Min(1)
  maxUsesTotal?: number;

  @ApiPropertyOptional({ description: 'Máximo de usos por cliente' })
  @IsOptional()
  @IsInt()
  @Min(1)
  maxUsesPerCustomer?: number;

  @ApiPropertyOptional({ description: 'Límite de usos de la promoción' })
  @IsOptional()
  @IsInt()
  @Min(1)
  usageLimit?: number;

  @ApiProperty({
    description: 'Fecha de inicio',
    example: '2026-08-04T00:00:00.000Z',
  })
  @IsDateString()
  startDate: string;

  @ApiProperty({
    description: 'Fecha de fin',
    example: '2026-08-31T23:59:59.000Z',
  })
  @IsDateString()
  endDate: string;

  @ApiPropertyOptional({
    description: 'Aplicar automáticamente',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  isAutoApply?: boolean;

  @ApiPropertyOptional({
    description: 'Prioridad (mayor = más prioridad)',
    default: 0,
  })
  @IsOptional()
  @IsInt()
  priority?: number;

  @ApiPropertyOptional({
    description: 'Aplicable con otras promociones',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  stackable?: boolean;

  @ApiPropertyOptional({
    description: 'Exclusiva (no combina con otras)',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  exclusive?: boolean;

  @ApiPropertyOptional({ description: 'Activa', default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdatePromotionDto {
  @ApiPropertyOptional({ description: 'Nombre de la promoción' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ description: 'Descripción de la promoción' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ enum: DiscountType })
  @IsOptional()
  @IsEnum(DiscountType)
  discountType?: DiscountType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  discountValue?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  maximumDiscount?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  weekdays?: number[];

  @ApiPropertyOptional({ type: [Number] })
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  categoryIds?: number[];

  @ApiPropertyOptional({
    description:
      'Sucursales donde aplica la promoción. Vacío = todas las sucursales.',
    type: [Number],
  })
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  branchIds?: number[];

  @ApiPropertyOptional({ type: [PromotionProductDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PromotionProductDto)
  products?: PromotionProductDto[];

  @ApiPropertyOptional({ type: [PromotionComboDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PromotionComboDto)
  combos?: PromotionComboDto[];

  @ApiPropertyOptional({
    description: 'Código de cupón (requerido si discountType es cupon)',
  })
  @IsOptional()
  @IsString()
  couponCode?: string;

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

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  usageLimit?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isAutoApply?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  priority?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  stackable?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  exclusive?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class QueryPromotionsDto {
  @ApiPropertyOptional({
    description: 'Filtrar por estado: activo, programado, expirado, inactivo',
  })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ description: 'Buscar por nombre o código de cupón' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: 'Filtrar promociones con usos hoy' })
  @IsOptional()
  @IsString()
  usagesToday?: string;

  @ApiPropertyOptional({ description: 'Límite de resultados' })
  @IsOptional()
  @IsString()
  limit?: string;

  @ApiPropertyOptional({ description: 'Offset para paginación' })
  @IsOptional()
  @IsString()
  offset?: string;
}
