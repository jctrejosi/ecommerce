import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CampaignsService } from './campaigns.service';
import {
  CreateCampaignDto,
  GenerateContentDto,
  GenerateRecipientsDto,
  UpdateCampaignDto,
} from './dto/campaign.dto';

@ApiTags('Admin - Campañas')
@Controller('admin/campaigns')
export class CampaignsController {
  constructor(private readonly campaignsService: CampaignsService) {}

  @Get()
  @ApiOperation({ summary: 'Listar campañas (opcional: filtrar por estado)' })
  @ApiResponse({ status: 200, description: 'Listado de campañas' })
  list(@Query('status') status?: string) {
    return this.campaignsService.list(status);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Crear una campaña' })
  @ApiResponse({ status: 201, description: 'Campaña creada' })
  create(@Body() dto: CreateCampaignDto) {
    return this.campaignsService.create(dto);
  }

  @Post('generate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Genera contenido con IA (/admin-ia): whatsapp, email (bloques del diseñador) y sms',
  })
  @ApiResponse({ status: 200, description: 'Contenido recomendado' })
  generate(@Body() dto: GenerateContentDto) {
    return this.campaignsService.generateContent(dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalle de una campaña con sus mensajes' })
  @ApiResponse({ status: 200, description: 'Detalle de la campaña' })
  findOne(@Param('id') id: string) {
    return this.campaignsService.findOne(Number(id));
  }

  @Put(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Actualizar una campaña' })
  @ApiResponse({ status: 200, description: 'Campaña actualizada' })
  update(@Param('id') id: string, @Body() dto: UpdateCampaignDto) {
    return this.campaignsService.update(Number(id), dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Eliminar una campaña (soft delete)' })
  @ApiResponse({ status: 200, description: 'Campaña eliminada' })
  remove(@Param('id') id: string) {
    return this.campaignsService.remove(Number(id));
  }

  @Get(':id/recipients')
  @ApiOperation({ summary: 'Listar destinatarios de la campaña' })
  @ApiResponse({ status: 200, description: 'Destinatarios' })
  recipients(@Param('id') id: string) {
    return this.campaignsService.listRecipients(Number(id));
  }

  @Post(':id/recipients/generate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Generar recomendación de clientes (aleatoria por ahora; segmentación inteligente después)',
  })
  @ApiResponse({ status: 200, description: 'Destinatarios recomendados' })
  generateRecipients(
    @Param('id') id: string,
    @Body() dto: GenerateRecipientsDto,
  ) {
    return this.campaignsService.generateRecipients(
      Number(id),
      dto.limit ?? 500,
    );
  }
}
