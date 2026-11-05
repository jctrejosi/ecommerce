import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CampaignsController } from './campaigns.controller';
import type { CampaignsService } from './campaigns.service';
import type {
  ApplyAudienceDto,
  CreateCampaignDto,
  GenerateContentDto,
  GenerateRecipientsDto,
  InterpretSegmentDto,
  ManualAudienceDto,
  ScoreClientsDto,
  SuggestNameDto,
  UpdateCampaignDto,
} from './dto/campaign.dto';

type ServiceMock = {
  [
    K in
      | 'list'
      | 'create'
      | 'generateContent'
      | 'suggestName'
      | 'segmentPreviewStream'
      | 'scoreClients'
      | 'clientFilterOptions'
      | 'addManualRecipients'
      | 'replaceManualRecipients'
      | 'useRecommendedAudience'
      | 'applyAudience'
      | 'interpretSegment'
      | 'relaunch'
      | 'history'
      | 'findOne'
      | 'update'
      | 'remove'
      | 'listRecipients'
      | 'generateRecipients'
  ]: ReturnType<typeof vi.fn>;
};

describe('CampaignsController', () => {
  let controller: CampaignsController;
  let service: ServiceMock;

  beforeEach(() => {
    service = {
      list: vi.fn(),
      create: vi.fn(),
      generateContent: vi.fn(),
      suggestName: vi.fn(),
      segmentPreviewStream: vi.fn(),
      scoreClients: vi.fn(),
      clientFilterOptions: vi.fn(),
      addManualRecipients: vi.fn(),
      replaceManualRecipients: vi.fn(),
      useRecommendedAudience: vi.fn(),
      applyAudience: vi.fn(),
      interpretSegment: vi.fn(),
      relaunch: vi.fn(),
      history: vi.fn(),
      findOne: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
      listRecipients: vi.fn(),
      generateRecipients: vi.fn(),
    };
    controller = new CampaignsController(
      service as unknown as CampaignsService,
    );
  });

  it('list delega el filtro de estado', () => {
    service.list.mockReturnValue('lista');

    expect(controller.list('enviada')).toBe('lista');
    expect(service.list).toHaveBeenCalledWith('enviada');
  });

  it('create delega el DTO completo', () => {
    const dto: CreateCampaignDto = {
      name: 'Verano',
      channels: ['whatsapp'],
    };
    service.create.mockReturnValue('creada');

    expect(controller.create(dto)).toBe('creada');
    expect(service.create).toHaveBeenCalledWith(dto);
  });

  it('generate delega el DTO de contenido', () => {
    const dto: GenerateContentDto = { channels: ['email'] };
    service.generateContent.mockReturnValue('contenido');

    expect(controller.generate(dto)).toBe('contenido');
    expect(service.generateContent).toHaveBeenCalledWith(dto);
  });

  it('suggestName delega el DTO', () => {
    const dto: SuggestNameDto = { products: [{ name: 'Café' }] };
    service.suggestName.mockReturnValue({ name: 'Oferta' });

    expect(controller.suggestName(dto)).toEqual({ name: 'Oferta' });
    expect(service.suggestName).toHaveBeenCalledWith(dto);
  });

  it('segmentPreview parsea productIds y normaliza limit/mode', () => {
    service.segmentPreviewStream.mockReturnValue('stream');

    const result = controller.segmentPreview(
      '1,2,3,abc,0,-4,1.5',
      '50',
      'bundle',
    );

    expect(result).toBe('stream');
    expect(service.segmentPreviewStream).toHaveBeenCalledWith(
      [1, 2, 3],
      50,
      'bundle',
    );
  });

  it('segmentPreview usa valores por defecto sin query', () => {
    controller.segmentPreview(
      undefined as unknown as string,
      undefined,
      undefined,
    );

    expect(service.segmentPreviewStream).toHaveBeenCalledWith(
      [],
      undefined,
      'multi',
    );
  });

  it('segmentPreview fuerza mode multi para valores desconocidos', () => {
    controller.segmentPreview('5', undefined, 'otro');

    expect(service.segmentPreviewStream).toHaveBeenCalledWith(
      [5],
      undefined,
      'multi',
    );
  });

  it('scoreClients delega el DTO', () => {
    const dto: ScoreClientsDto = { minPropensity: 0.7, limit: 10 };
    service.scoreClients.mockReturnValue('scores');

    expect(controller.scoreClients(dto)).toBe('scores');
    expect(service.scoreClients).toHaveBeenCalledWith(dto);
  });

  it('clientFilterOptions delega sin argumentos', () => {
    service.clientFilterOptions.mockReturnValue('opciones');

    expect(controller.clientFilterOptions()).toBe('opciones');
    expect(service.clientFilterOptions).toHaveBeenCalledWith();
  });

  it('addManualRecipients convierte el id y separa cédulas/filtros', () => {
    const dto: ManualAudienceDto = {
      cedulas: ['A'],
      filters: { minEdad: 18 },
    };
    service.addManualRecipients.mockReturnValue('ok');

    expect(controller.addManualRecipients('7', dto)).toBe('ok');
    expect(service.addManualRecipients).toHaveBeenCalledWith(7, ['A'], {
      minEdad: 18,
    });
  });

  it('addManualRecipients pasa filtros undefined si no vienen', () => {
    void controller.addManualRecipients('7', { cedulas: ['A'] });

    expect(service.addManualRecipients).toHaveBeenCalledWith(
      7,
      ['A'],
      undefined,
    );
  });

  it('replaceManualRecipients convierte el id y delega', () => {
    const dto: ManualAudienceDto = { filters: { ciudades: ['Cali'] } };
    service.replaceManualRecipients.mockReturnValue('ok');

    expect(controller.replaceManualRecipients('9', dto)).toBe('ok');
    expect(service.replaceManualRecipients).toHaveBeenCalledWith(9, undefined, {
      ciudades: ['Cali'],
    });
  });

  it('useRecommendedAudience convierte el id', () => {
    void controller.useRecommendedAudience('3');

    expect(service.useRecommendedAudience).toHaveBeenCalledWith(3);
  });

  it('applyAudience delega modo, cédulas y filtros', () => {
    const dto: ApplyAudienceDto = {
      mode: 'mixed',
      cedulas: ['A', 'B'],
      filters: { minFrecuencia: 2 },
    };

    void controller.applyAudience('4', dto);

    expect(service.applyAudience).toHaveBeenCalledWith(4, 'mixed', ['A', 'B'], {
      minFrecuencia: 2,
    });
  });

  it('interpretSegment delega el DTO', () => {
    const dto: InterpretSegmentDto = { bestSegment: 3, total: 10 };

    void controller.interpretSegment(dto);

    expect(service.interpretSegment).toHaveBeenCalledWith(dto);
  });

  it('relaunch convierte el id', () => {
    void controller.relaunch('12');

    expect(service.relaunch).toHaveBeenCalledWith(12);
  });

  it('history convierte el id', () => {
    void controller.history('12');

    expect(service.history).toHaveBeenCalledWith(12);
  });

  it('findOne convierte el id', () => {
    void controller.findOne('12');

    expect(service.findOne).toHaveBeenCalledWith(12);
  });

  it('update convierte el id y delega el DTO', () => {
    const dto: UpdateCampaignDto = { name: 'Nuevo' };

    void controller.update('12', dto);

    expect(service.update).toHaveBeenCalledWith(12, dto);
  });

  it('remove convierte el id', () => {
    void controller.remove('12');

    expect(service.remove).toHaveBeenCalledWith(12);
  });

  it('recipients convierte el id', () => {
    void controller.recipients('12');

    expect(service.listRecipients).toHaveBeenCalledWith(12);
  });

  it('generateRecipients aplica el límite por defecto de 500', () => {
    void controller.generateRecipients('12', {});

    expect(service.generateRecipients).toHaveBeenCalledWith(
      12,
      500,
      undefined,
      undefined,
      undefined,
    );
  });

  it('generateRecipients delega todos los parámetros', () => {
    const dto: GenerateRecipientsDto = {
      limit: 25,
      segment: 2,
      modelName: 'seg_v2',
      mode: 'bundle',
    };

    void controller.generateRecipients('12', dto);

    expect(service.generateRecipients).toHaveBeenCalledWith(
      12,
      25,
      2,
      'seg_v2',
      'bundle',
    );
  });

  it('devuelve la promesa del servicio sin envolverla', async () => {
    service.list.mockResolvedValue([{ id: 1 }]);

    await expect(controller.list()).resolves.toEqual([{ id: 1 }]);
  });

  it('propaga los errores del servicio', async () => {
    service.findOne.mockRejectedValue(
      new NotFoundException('Campaña no encontrada'),
    );

    await expect(controller.findOne('99')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('propaga errores de validación del servicio', async () => {
    service.generateRecipients.mockRejectedValue(
      new BadRequestException('No hay clientes disponibles para recomendar'),
    );

    await expect(controller.generateRecipients('1', {})).rejects.toThrow(
      'No hay clientes disponibles para recomendar',
    );
  });
});
