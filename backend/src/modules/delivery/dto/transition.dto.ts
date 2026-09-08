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
}
