import { IsISO8601, IsLatitude, IsLongitude, IsNumber, IsOptional } from 'class-validator';

export class LocationDto {
  @IsLatitude()
  lat!: number;

  @IsLongitude()
  lng!: number;

  @IsOptional()
  @IsNumber()
  speed?: number | null;

  @IsOptional()
  @IsNumber()
  heading?: number | null;

  @IsOptional()
  @IsISO8601()
  timestamp?: string;
}
