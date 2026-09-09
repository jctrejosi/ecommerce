import {
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
} from 'class-validator';

export class TransitionDto {
  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsLatitude()
  lat?: number;

  @IsOptional()
  @IsLongitude()
  lng?: number;

  @IsOptional()
  @IsString()
  note?: string;

  /** Foto del lugar de entrega (URL ya subida), obligatoria en 'deliver'. */
  @IsOptional()
  @IsString()
  proofLocationUrl?: string;

  /** Foto del pedido entregado (URL ya subida), obligatoria en 'deliver'. */
  @IsOptional()
  @IsString()
  proofPackageUrl?: string;
}
