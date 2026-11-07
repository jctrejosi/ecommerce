import {
  IsArray,
  IsNumber,
  IsOptional,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { UpdateCartItemDto } from './update-cart.dto';

/** Cotización sin sesión: mismos ítems del carrito, sin persistirlos. */
export class QuoteCartDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpdateCartItemDto)
  items!: UpdateCartItemDto[];

  @IsOptional()
  @Transform(({ value }) =>
    value === null || value === undefined || value === '' ? null : Number(value),
  )
  @IsNumber()
  branchId?: number | null;
}
