import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class CustomerGoogleCodeDto {
  @ApiProperty({
    description: 'Código de autorización devuelto por Google (flujo code).',
  })
  @IsString()
  code!: string;

  @ApiPropertyOptional({
    description:
      'redirect_uri usado en la solicitud de autorización (debe coincidir).',
  })
  @IsOptional()
  @IsString()
  redirectUri?: string;
}
