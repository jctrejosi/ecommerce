import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Put,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { QrService } from './qr.service';
import { GenerateQrDto, SaveQrConfigDto } from './qr.dto';

const ALLOWED_MIMETYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'application/pdf',
]);
const MAX_QR_FILE_BYTES = 10 * 1024 * 1024; // 10 MB

@ApiTags('QR Service')
@Controller('admin/qr')
export class AdminQrController {
  constructor(private readonly qrService: QrService) {}

  @Get('status')
  @ApiOperation({ summary: 'Estado del servicio QR Analyzer' })
  @ApiResponse({
    status: 200,
    description: 'Disponibilidad del servicio externo',
  })
  status() {
    return this.qrService.status();
  }

  @Post('generate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Generar un QR vía el servicio QR Analyzer' })
  @ApiResponse({
    status: 200,
    description: 'QR generado en base64 (PNG o PDF)',
  })
  @ApiResponse({
    status: 503,
    description: 'Servicio QR Analyzer no disponible',
  })
  generate(@Body() dto: GenerateQrDto) {
    return this.qrService.generate(dto);
  }

  @Post('upload')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Subir un QR (imagen o PDF), decodificarlo y guardarlo',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'Imagen o PDF con QR',
        },
      },
    },
  })
  @UseInterceptors(FileInterceptor('file'))
  async upload(@UploadedFile() file?: Express.Multer.File) {
    if (!file || !file.buffer || file.buffer.length === 0) {
      throw new BadRequestException('Archivo requerido');
    }
    if (!ALLOWED_MIMETYPES.has(file.mimetype)) {
      throw new BadRequestException(
        `Formato no soportado (${file.mimetype}). Usa PNG, JPG, WebP o PDF.`,
      );
    }
    if (file.buffer.length > MAX_QR_FILE_BYTES) {
      throw new BadRequestException(
        'El archivo supera el tamaño máximo (10 MB).',
      );
    }

    // 1) Decodificar + regenerar en una sola llamada a QR Analyzer
    const processed = await this.qrService.processFile(
      file.buffer,
      file.originalname,
      file.mimetype,
      'png',
      400,
      'M',
      4,
    );

    const decoded: any = processed?.['decoded'];
    const generated: any = processed?.['generated'];

    const items: any[] = decoded?.['items'] ?? [];
    if (!items.length) {
      throw new BadRequestException(
        'No se detectó ningún código QR en el archivo.',
      );
    }

    // 2) Guardar el QR regenerado (PNG)
    const pngBuffer = Buffer.from(String(generated?.content_base64), 'base64');
    const saved = await this.qrService.saveQrFile(
      pngBuffer,
      'qr-pago.png',
      'image/png',
    );

    return { ...saved, decoded, generated: true };
  }

  @Get('config')
  @ApiOperation({
    summary: 'Obtener la configuración guardada del QR',
  })
  @ApiResponse({
    status: 200,
    description: 'Configuración actual (archivo + método de generación)',
  })
  getConfig() {
    return this.qrService.getConfig();
  }

  @Put('config')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Guardar la configuración del QR (archivo + método de generación)',
  })
  @ApiResponse({ status: 200, description: 'Configuración guardada' })
  saveConfig(@Body() dto: SaveQrConfigDto) {
    return this.qrService.saveConfig(dto);
  }
}

@ApiTags('QR Service')
@Controller('qr')
export class QrPublicController {
  constructor(private readonly qrService: QrService) {}

  @Public()
  @Get('config')
  @ApiOperation({
    summary: 'Configuración pública del QR para la web',
  })
  @ApiResponse({
    status: 200,
    description: 'QR habilitado con URL del archivo (imagen o PDF)',
  })
  getConfig() {
    return this.qrService.getPublicConfig();
  }
}
