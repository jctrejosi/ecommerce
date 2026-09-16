import {
  IsArray,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';

export class CreateOrderItemDto {
  @Transform(({ value }) => Number(value))
  @IsNumber()
  @Min(1)
  productId!: number;

  @Transform(({ value }) => Number(value))
  @IsNumber()
  @Min(1)
  quantity!: number;
}

export class CreateOrderAddressDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @Matches(/^3\d{9}$/, {
    message: 'El teléfono debe ser un celular válido (10 dígitos, ej: 3001234567)',
  })
  phone!: string;

  @IsString()
  @IsNotEmpty()
  address!: string;

  @IsString()
  @IsNotEmpty()
  city!: string;

  /**
   * Coordenadas del destino (opcionales).
   *
   * Sin ellas el mapa no puede trazar la ruta: el repartidor ve la dirección
   * como texto, pero ni el seguimiento del cliente ni el mapa de flota tienen
   * un punto al que apuntar.
   */
  @IsOptional()
  @Transform(({ value }) => (value == null ? undefined : Number(value)))
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat?: number;

  @IsOptional()
  @Transform(({ value }) => (value == null ? undefined : Number(value)))
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng?: number;

  @IsEmail({}, { message: 'El email no es válido' })
  email!: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class CardPaymentDetailsDto {
  @IsOptional()
  @IsString()
  provider?: 'epayco' | 'wompi';

  @IsString()
  @IsNotEmpty()
  cardholderName!: string;

  @IsString()
  @IsNotEmpty()
  cardToken!: string;

  @IsOptional()
  @IsString()
  acceptanceToken?: string;

  @IsOptional()
  @IsString()
  acceptPersonalAuth?: string;

  @IsString()
  @IsNotEmpty()
  last4!: string;

  @IsString()
  @IsNotEmpty()
  brand!: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  installments?: number;
}

export class PsePaymentDetailsDto {
  @IsString()
  @IsNotEmpty()
  bank!: string;

  @IsEnum(['natural', 'juridica'])
  personType!: 'natural' | 'juridica';
}

export class NequiPaymentDetailsDto {
  @IsString()
  @IsNotEmpty()
  phone!: string;
}

export class PaymentDetailsDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => CardPaymentDetailsDto)
  card?: CardPaymentDetailsDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => PsePaymentDetailsDto)
  pse?: PsePaymentDetailsDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => NequiPaymentDetailsDto)
  nequi?: NequiPaymentDetailsDto;
}

export class CreateOrderDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateOrderItemDto)
  items!: CreateOrderItemDto[];

  @ValidateNested()
  @Type(() => CreateOrderAddressDto)
  address!: CreateOrderAddressDto;

  @IsEnum(['standard', 'express'])
  shippingType!: 'standard' | 'express';

  @IsEnum(['efectivo', 'tarjeta', 'nequi', 'pse', 'breb'])
  paymentMethod!: 'efectivo' | 'tarjeta' | 'nequi' | 'pse' | 'breb';

  @IsOptional()
  @ValidateNested()
  @Type(() => PaymentDetailsDto)
  paymentDetails?: PaymentDetailsDto;
}
