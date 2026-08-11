import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class GenerateQrDto {
  @ApiProperty({
    description: 'Contenido que se codificará en el QR',
    example: 'https://mercaldas.com.co/promo?code=QR25',
  })
  @IsString()
  @MaxLength(8192)
  text: string;

  @ApiPropertyOptional({
    description: 'Formato de salida',
    enum: ['png', 'pdf'],
    default: 'png',
  })
  @IsOptional()
  @IsIn(['png', 'pdf'])
  format?: 'png' | 'pdf';

  @ApiPropertyOptional({
    description: 'Tamaño del cuadrado en píxeles',
    default: 400,
    minimum: 100,
    maximum: 4096,
  })
  @IsOptional()
  @IsInt()
  @Min(100)
  @Max(4096)
  size?: number;

  @ApiPropertyOptional({
    description: 'Nivel de corrección de errores',
    enum: ['L', 'M', 'Q', 'H'],
    default: 'M',
  })
  @IsOptional()
  @IsIn(['L', 'M', 'Q', 'H'])
  errorCorrection?: 'L' | 'M' | 'Q' | 'H';

  @ApiPropertyOptional({
    description: 'Borde (zona de silencio) en módulos',
    default: 4,
    minimum: 0,
    maximum: 40,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(40)
  border?: number;
}

export class SaveQrConfigDto {
  @ApiPropertyOptional({
    description: 'ID del media del QR (imagen o PDF) que se usará en la web',
  })
  @IsOptional()
  @IsInt()
  fileMediaId?: number;

  @ApiPropertyOptional({ description: 'Nombre del archivo guardado' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  fileName?: string;

  @ApiPropertyOptional({
    description: 'Tipo MIME del archivo (image/png, application/pdf...)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  mimeType?: string;

  @ApiPropertyOptional({
    description: 'Origen del QR',
    enum: ['generated', 'uploaded'],
  })
  @IsOptional()
  @IsIn(['generated', 'uploaded'])
  source?: 'generated' | 'uploaded';

  @ApiPropertyOptional({ description: 'Texto decodificado/generado' })
  @IsOptional()
  @IsString()
  @MaxLength(8192)
  text?: string;

  @ApiPropertyOptional({
    description:
      'Información extraída con /decode (formato, estructura, página...)',
  })
  @IsOptional()
  decoded?: Record<string, unknown>;

  @ApiPropertyOptional({
    description: 'Parámetros con los que se generó el QR',
  })
  @IsOptional()
  generation?: Record<string, unknown>;

  @ApiPropertyOptional({
    description: 'Habilitar el QR en la web',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
