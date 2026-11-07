import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CampaignsService } from './campaigns.service';
import { createDbMock } from '../../../test/helpers/db-mock';
import type { DrizzleService } from '../../database/drizzle.service';

/* ── Fixtures ─────────────────────────────────────────────── */

interface CampaignFixture {
  id: number;
  name: string;
  productId: number | null;
  prompt: string | null;
  tone: string | null;
  channels: string[];
  priorityChannel: string | null;
  mode: string;
  status: string;
  audienceMode: string;
  audienceCount: number;
  scheduledAt: string | null;
  sentAt: string | null;
  sentCount: number;
  openedCount: number;
  convertedCount: number;
  createdBy: number | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

function makeCampaignRow(
  overrides: Partial<CampaignFixture> = {},
): CampaignFixture {
  return {
    id: 1,
    name: 'Verano',
    productId: null,
    prompt: null,
    tone: null,
    channels: ['whatsapp'],
    priorityChannel: 'whatsapp',
    mode: 'multi',
    status: 'borrador',
    audienceMode: 'auto',
    audienceCount: 0,
    scheduledAt: null,
    sentAt: null,
    sentCount: 0,
    openedCount: 0,
    convertedCount: 0,
    createdBy: 9,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-02T00:00:00.000Z',
    deletedAt: null,
    ...overrides,
  };
}

interface RecipientFixture {
  id: bigint;
  campaignId: bigint;
  customerId: bigint | null;
  cedula: string | null;
  segmento: number | null;
  frecuencia: number | null;
  monetario: number | null;
  ticketPromedio: number | null;
  categoriasDistintas: number | null;
  propensity: number | null;
  name: string | null;
  email: string | null;
  phone: string | null;
}

function makeRecipientRow(
  overrides: Partial<RecipientFixture> = {},
): RecipientFixture {
  return {
    id: 11n,
    campaignId: 5n,
    customerId: 3n,
    cedula: '010203',
    segmento: 2,
    frecuencia: 4,
    monetario: 100,
    ticketPromedio: 25,
    categoriasDistintas: 3,
    propensity: 0.8,
    name: 'Ana',
    email: 'ana@test.local',
    phone: '3000000000',
    ...overrides,
  };
}

interface Client {
  cedula: string;
  segment: number;
  features?: {
    frecuencia: number;
    monetario: number;
    ticket_promedio: number;
    categorias_distintas: number;
  };
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  consent_email?: boolean;
  consent_whatsapp?: boolean;
  consent_sms?: boolean;
}

function makeClient(cedula: string, overrides: Partial<Client> = {}): Client {
  return {
    cedula,
    segment: 1,
    features: {
      frecuencia: 1,
      monetario: 100,
      ticket_promedio: 100,
      categorias_distintas: 1,
    },
    name: `Cliente ${cedula}`,
    email: `${cedula.toLowerCase()}@test.local`,
    phone: `300${cedula}`,
    ...overrides,
  };
}

/* ── Mock de fetch (enrutado por fragmento de URL) ────────── */

type FetchInit = {
  method?: string;
  body?: string;
  headers?: Record<string, string>;
};

type FetchCall = {
  url: string;
  method?: string;
  body?: unknown;
  headers?: unknown;
};

function json(body: unknown, status = 200): Response {
  return {
    ok: status < 400,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
    body: null,
  } as unknown as Response;
}

/** Respuesta SSE: un frame `data: {...}\n\n` por evento. */
function sse(events: unknown[], status = 200): Response {
  const text = events
    .map((e) => (typeof e === 'string' ? e : `data: ${JSON.stringify(e)}`))
    .map((line) => `${line}\n\n`)
    .join('');
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
  return {
    ok: status < 400,
    status,
    json: () => Promise.resolve({}),
    text: () => Promise.resolve(text),
    body: stream,
  } as unknown as Response;
}

type FetchHandler = (body: unknown) => Response;

interface PreviewEvent {
  data: {
    stage?: string;
    error?: string;
    message?: string;
    progress?: number;
    result?: {
      segment: number;
      segmentTotal: number;
      total: number;
      buyers: number;
      mode: string;
      bundleFallback: boolean;
      recipients: Array<{
        cedula: string;
        propensity: number | null;
        uplift: number | null;
        percentile: number | null;
      }>;
    };
  };
}

type CampaignView = Awaited<ReturnType<CampaignsService['findOne']>>;
type GenerateResult = Awaited<
  ReturnType<CampaignsService['generateRecipients']>
>;

/** Cédulas con las que clustering-api resuelve una audiencia manual. */
function filterCedulas(body: unknown): string[] | undefined {
  return (body as { filters?: { cedulas?: string[] } }).filters?.cedulas;
}

describe('CampaignsService', () => {
  let mock: ReturnType<typeof createDbMock>;
  let service: CampaignsService;
  let routes: Map<string, FetchHandler>;
  let fetchMock: Mock;

  beforeEach(() => {
    mock = createDbMock();
    service = new CampaignsService(mock.drizzle as unknown as DrizzleService);
    routes = new Map();
    fetchMock = vi.fn((url: string, init?: FetchInit) => {
      const body = (
        typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body
      ) as unknown;
      for (const [fragment, handler] of routes) {
        if (String(url).includes(fragment)) return handler(body);
      }
      throw new Error(`fetch no mockeado: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function fetchCalls(): FetchCall[] {
    const calls = fetchMock.mock.calls as Array<[string, FetchInit?]>;
    return calls.map(([url, init]) => ({
      url,
      method: init?.method,
      body: (typeof init?.body === 'string'
        ? JSON.parse(init.body)
        : init?.body) as unknown,
      headers: init?.headers,
    }));
  }

  function callsTo(fragment: string): FetchCall[] {
    return fetchCalls().filter((c) => c.url.includes(fragment));
  }

  /** Cuerpo JSON de la n-ésima llamada a un endpoint. */
  function bodyOf(fragment: string, index = 0): Record<string, unknown> {
    return (callsTo(fragment)[index]?.body ?? {}) as Record<string, unknown>;
  }

  /** Valores del n-ésimo `update` ejecutado. */
  function updatedValues(index = 0): Record<string, unknown> {
    return mock.state.updates[index].values;
  }

  /** Valores insertados por el n-ésimo `insert`. */
  function insertedValues(index = 0): unknown {
    return mock.state.inserts[index]?.values;
  }

  /** Fila insertada cuando el `insert` recibió un único objeto. */
  function insertedRow(index = 0): Record<string, unknown> {
    const values = insertedValues(index);
    const row = Array.isArray(values) ? (values as unknown[])[0] : values;
    return (row ?? {}) as Record<string, unknown>;
  }

  /** Filas insertadas por el n-ésimo `insert` cuando recibió un array. */
  function insertedRows(index = 0): Array<Record<string, unknown>> {
    const values = insertedValues(index);
    return Array.isArray(values)
      ? (values as Array<Record<string, unknown>>)
      : [];
  }

  /** Spoilea `findOne` para no encadenar selects de detalle. */
  function spyFindOne(...rows: unknown[]) {
    const spy = vi.spyOn(service, 'findOne');
    for (const row of rows) spy.mockResolvedValueOnce(row as CampaignView);
    return spy;
  }

  /** Encadena los `select` que hace `findOne` (en su orden real). */
  function queueFindOne(opts: {
    campaign?: CampaignFixture | null;
    messages?: unknown[];
    product?: { id: bigint; name: string } | null;
    campaignProducts?: { productId: bigint; position: number }[];
    productRows?: { id: bigint; name: string }[];
    recipientsCount?: number;
  }) {
    mock.queueSelect(opts.campaign ? [opts.campaign] : []);
    if (!opts.campaign) return;
    mock.queueSelect(opts.messages ?? []);
    if (opts.campaign.productId != null) {
      mock.queueSelect(opts.product ? [opts.product] : []);
    }
    const campaignProducts = opts.campaignProducts ?? [];
    mock.queueSelect(campaignProducts);
    if (campaignProducts.length) mock.queueSelect(opts.productRows ?? []);
    mock.queueSelect([{ count: opts.recipientsCount ?? 0 }]);
  }

  /* ── findOne ──────────────────────────────────────────── */

  describe('findOne', () => {
    it('lanza NotFoundException cuando la campaña no existe', async () => {
      mock.queueSelect([]);
      await expect(service.findOne(99)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('devuelve producto principal, productos, mensajes y contador', async () => {
      queueFindOne({
        campaign: makeCampaignRow({ productId: 3, createdBy: 9 }),
        messages: [
          { id: 1n, campaignId: 1n, channel: 'whatsapp', content: 'Hola' },
        ],
        product: { id: 3n, name: 'Café' },
        campaignProducts: [
          { productId: 3n, position: 0 },
          { productId: 5n, position: 1 },
        ],
        productRows: [
          { id: 3n, name: 'Café' },
          { id: 5n, name: 'Azúcar' },
        ],
        recipientsCount: 12,
      });

      const result = await service.findOne(1);

      expect(result).toMatchObject({
        id: 1,
        product: { id: 3, name: 'Café' },
        products: [
          { id: 3, name: 'Café' },
          { id: 5, name: 'Azúcar' },
        ],
        recipientsCount: 12,
      });
      expect(result.messages).toEqual([
        { id: 1, campaignId: 1n, channel: 'whatsapp', content: 'Hola' },
      ]);
    });

    it('deja product en null y el contador en 0 sin destinatarios', async () => {
      queueFindOne({ campaign: makeCampaignRow() });

      const result = await service.findOne(1);

      expect(result.product).toBeNull();
      expect(result.products).toEqual([]);
      expect(result.recipientsCount).toBe(0);
    });
  });

  /* ── list ─────────────────────────────────────────────── */

  describe('list', () => {
    it('devuelve un array vacío sin consultar mensajes', async () => {
      mock.queueSelect([]);

      await expect(service.list()).resolves.toEqual([]);
      expect(mock.db.select).toHaveBeenCalledTimes(1);
    });

    it('agrupa mensajes y productos por campaña', async () => {
      mock.queueSelect([
        makeCampaignRow({ id: 1, productId: 3 }),
        makeCampaignRow({ id: 2, name: 'Invierno' }),
      ]);
      mock.queueSelect([
        { id: 1n, campaignId: 1n, channel: 'whatsapp' },
        { id: 2n, campaignId: 2n, channel: 'email' },
        { id: 3n, campaignId: 1n, channel: 'sms' },
      ]);
      // loadProducts: solo el productId principal de cada campaña.
      mock.queueSelect([{ id: 3n, name: 'Café' }]);
      // loadCampaignProducts
      mock.queueSelect([{ campaignId: 1n, productId: 3n, position: 0 }]);

      const result = await service.list();

      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({
        id: 1,
        product: { id: 3, name: 'Café' },
        products: [{ id: 3, name: 'Café' }],
      });
      expect(result[0].messages.map((m) => m.id)).toEqual([1, 3]);
      expect(result[1]).toMatchObject({ id: 2, product: null, products: [] });
      expect(result[1].messages.map((m) => m.id)).toEqual([2]);
    });
  });

  /* ── create ───────────────────────────────────────────── */

  describe('create', () => {
    it('crea campaña con productos, mensajes e historial', async () => {
      spyFindOne({ id: 42 });
      mock.queueInsert([{ id: 42n }]);

      const result = await service.create(
        {
          name: 'Verano',
          productIds: [7, 7, 9],
          prompt: 'promo',
          tone: 'cercano',
          channels: ['email', 'sms'],
          priorityChannel: 'sms',
          mode: 'bundle',
          messages: [
            { channel: 'whatsapp', content: 'Hola' },
            { channel: 'email', subject: 'Asunto' },
          ],
        },
        5,
      );

      expect(result).toEqual({ id: 42 });

      expect(mock.state.inserts[0].values).toMatchObject({
        name: 'Verano',
        productId: 7,
        prompt: 'promo',
        tone: 'cercano',
        channels: ['email', 'sms'],
        priorityChannel: 'sms',
        mode: 'bundle',
        createdBy: 5,
      });
      // Dedupe + posición de los productos.
      expect(mock.state.inserts[1].values).toEqual([
        { campaignId: 42, productId: 7, position: 0 },
        { campaignId: 42, productId: 9, position: 1 },
      ]);
      // Mensajes: los campos ausentes se guardan como null.
      expect(mock.state.inserts[2].values).toEqual({
        campaignId: 42,
        channel: 'whatsapp',
        subject: null,
        content: 'Hola',
        html: null,
        emailBlocks: null,
      });
      expect(mock.state.inserts[3].values).toEqual({
        campaignId: 42,
        channel: 'email',
        subject: 'Asunto',
        content: null,
        html: null,
        emailBlocks: null,
      });
      expect(mock.state.inserts[4].values).toMatchObject({
        campaignId: 42,
        action: 'created',
        status: 'borrador',
        details: {
          name: 'Verano',
          productIds: [7, 7, 9],
          channels: ['email', 'sms'],
          mode: 'bundle',
          messages: 2,
        },
        createdBy: 5,
      });
      expect(mock.state.deletes).toHaveLength(1);
    });

    it('usa productId cuando no hay productIds y deja createdBy en null', async () => {
      spyFindOne({ id: 7 });
      mock.queueInsert([{ id: 7n }]);

      await service.create({ name: 'Simple', productId: 4 });

      expect(mock.state.inserts[0].values).toMatchObject({
        productId: 4,
        createdBy: null,
        mode: 'multi',
        channels: [],
        priorityChannel: null,
      });
      expect(mock.state.inserts[1].values).toEqual([
        { campaignId: 7, productId: 4, position: 0 },
      ]);
      expect(mock.state.inserts[2].values).toMatchObject({
        action: 'created',
        status: 'borrador',
        createdBy: null,
      });
    });

    it('resuelve el canal prioritario al primer canal activo', async () => {
      spyFindOne({ id: 1 });
      mock.queueInsert([{ id: 1n }]);

      await service.create({
        name: 'Sin canal preferido',
        channels: ['sms', 'email'],
        priorityChannel: 'whatsapp',
      });

      expect(insertedRow(0)).toMatchObject({ priorityChannel: 'email' });
    });

    it('deja priorityChannel null cuando no hay canales activos', async () => {
      spyFindOne({ id: 1 });
      mock.queueInsert([{ id: 1n }]);

      await service.create({ name: 'Vacía' });

      expect(insertedRow(0)).toMatchObject({
        channels: [],
        priorityChannel: null,
      });
    });

    it('sin productos no inserta filas en campaign_products', async () => {
      spyFindOne({ id: 1 });
      mock.queueInsert([{ id: 1n }]);

      await service.create({ name: 'Sin productos' });

      expect(insertedRow(0)).toMatchObject({ productId: null });
      // Solo campaña + historial.
      expect(mock.state.inserts).toHaveLength(2);
      expect(mock.state.deletes).toHaveLength(1);
    });
  });

  /* ── update ───────────────────────────────────────────── */

  describe('update', () => {
    it('actualiza campos, reemplaza productos y registra historial', async () => {
      const existing = makeCampaignRow({
        id: 5,
        productId: 3,
        channels: ['whatsapp'],
        status: 'borrador',
      });
      spyFindOne(existing, { ...existing, name: 'Nuevo' });
      mock.queueUpdate([{ ...existing, name: 'Nuevo' }]);

      await service.update(5, {
        name: 'Nuevo',
        productIds: [8, 8, 2],
        channels: ['sms', 'email'],
        status: 'programada',
      });

      // upsertCampaignProducts dedupe con posiciones.
      expect(mock.state.inserts[0].values).toEqual([
        { campaignId: 5, productId: 8, position: 0 },
        { campaignId: 5, productId: 2, position: 1 },
      ]);
      expect(updatedValues()).toMatchObject({
        name: 'Nuevo',
        productId: 8,
        channels: ['sms', 'email'],
        // 'whatsapp' ya no está activo → primer canal por prioridad
        // (whatsapp → email → sms), es decir, 'email'.
        priorityChannel: 'email',
        mode: 'multi',
        status: 'programada',
      });
      expect(updatedValues().updatedAt).toEqual(expect.any(String));
      expect(insertedRow(1)).toMatchObject({
        campaignId: 5,
        action: 'updated',
        status: 'programada',
        details: { name: 'Nuevo', productIds: [8, 8, 2] },
      });
    });

    it('conserva el producto existente si no se envían productos', async () => {
      const existing = makeCampaignRow({ id: 5, productId: 3 });
      spyFindOne(existing, existing);
      mock.queueUpdate([existing]);

      await service.update(5, { tone: 'formal' });

      expect(updatedValues()).toMatchObject({
        tone: 'formal',
        productId: 3,
        priorityChannel: 'whatsapp',
      });
      // No se reemplazan productos ni se tocan mensajes.
      expect(mock.state.inserts).toHaveLength(1); // solo historial
      expect(insertedRow(0)).toMatchObject({ action: 'updated' });
    });

    it('actualiza mensajes cuando vienen en el DTO', async () => {
      const existing = makeCampaignRow({ id: 5 });
      spyFindOne(existing, existing);
      mock.queueUpdate([existing]);

      await service.update(5, {
        messages: [{ channel: 'sms', content: 'Corto' }],
      });

      expect(mock.state.inserts[0].values).toMatchObject({
        campaignId: 5,
        channel: 'sms',
        content: 'Corto',
      });
      expect(insertedRow(1)).toMatchObject({ action: 'updated' });
    });

    it('lanza NotFoundException si el update no devuelve filas', async () => {
      spyFindOne(makeCampaignRow({ id: 5 }));
      mock.queueUpdate([]);

      await expect(service.update(5, { name: 'X' })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  /* ── remove ───────────────────────────────────────────── */

  describe('remove', () => {
    it('registra el borrado y hace soft delete', async () => {
      spyFindOne(makeCampaignRow({ id: 5, productId: 3, mode: 'bundle' }));

      await expect(service.remove(5)).resolves.toEqual({ success: true });

      expect(insertedRow(0)).toMatchObject({
        campaignId: 5,
        action: 'deleted',
        details: { name: 'Verano', productId: 3, mode: 'bundle' },
      });
      expect(updatedValues().deletedAt).toEqual(expect.any(String));
      expect(mock.state.updates).toHaveLength(1);
    });
  });

  /* ── relaunch ─────────────────────────────────────────── */

  describe('relaunch', () => {
    it('re-segmenta, reinicia contadores y deja el historial', async () => {
      const existing = makeCampaignRow({ id: 5, mode: 'bundle' });
      spyFindOne(existing, { ...existing, status: 'enviada' });
      const generate = vi
        .spyOn(service, 'generateRecipients')
        .mockResolvedValue({ total: 12 } as GenerateResult);

      await service.relaunch(5);

      expect(generate).toHaveBeenCalledWith(
        5,
        100000,
        undefined,
        undefined,
        'bundle',
      );
      expect(updatedValues()).toMatchObject({
        status: 'enviada',
        sentCount: 0,
        openedCount: 0,
        convertedCount: 0,
      });
      expect(updatedValues().sentAt).toEqual(expect.any(String));
      expect(updatedValues().updatedAt).toEqual(expect.any(String));
      expect(insertedRow(0)).toMatchObject({
        campaignId: 5,
        action: 'relaunched',
        status: 'enviada',
        details: { name: 'Verano', mode: 'bundle', recipientsCount: 12 },
      });
    });

    it('relanza igualmente si la re-segmentación falla (0 destinatarios)', async () => {
      spyFindOne(makeCampaignRow({ id: 5 }), makeCampaignRow({ id: 5 }));
      vi.spyOn(service, 'generateRecipients').mockRejectedValue(
        new Error('clustering caído'),
      );

      await service.relaunch(5);

      expect(insertedRow(0).details).toMatchObject({ recipientsCount: 0 });
      expect(updatedValues().status).toBe('enviada');
    });
  });

  /* ── history ──────────────────────────────────────────── */

  describe('history', () => {
    it('serializa ids y conserva el detalle', async () => {
      mock.queueSelect([
        {
          id: 3n,
          campaignId: 5n,
          action: 'created',
          status: 'borrador',
          details: { name: 'Verano' },
          createdAt: '2024-01-01',
        },
      ]);

      await expect(service.history(5)).resolves.toEqual([
        {
          id: 3,
          campaignId: 5,
          action: 'created',
          status: 'borrador',
          details: { name: 'Verano' },
          createdAt: '2024-01-01',
        },
      ]);
    });
  });

  /* ── listRecipients ───────────────────────────────────── */

  describe('listRecipients', () => {
    it('expone `segment` (no `segmento`) y numericiza ids', async () => {
      spyFindOne(makeCampaignRow({ id: 5 }));
      mock.queueSelect([
        makeRecipientRow(),
        makeRecipientRow({ id: 12n, customerId: null, segmento: null }),
      ]);

      const result = await service.listRecipients(5);

      expect(result[0]).toMatchObject({
        id: 11,
        customerId: 3,
        segment: 2,
      });
      expect(result[0]).not.toHaveProperty('segmento');
      expect(result[1]).toMatchObject({
        id: 12,
        customerId: null,
        segment: null,
      });
    });
  });

  /* ── generateRecipients ───────────────────────────────── */

  describe('generateRecipients', () => {
    const segRecipients: Client[] = [
      makeClient('A', {
        segment: 3,
        email: 'ana@test.local',
        phone: '111',
        features: {
          frecuencia: 5,
          monetario: 500,
          ticket_promedio: 100,
          categorias_distintas: 4,
        },
      }),
      makeClient('B', { segment: 3, email: 'beto@test.local', phone: '222' }),
      makeClient('C', { segment: 3, email: 'carla@test.local', phone: '333' }),
    ];

    function routePropensity(probabilities: (number | undefined)[]) {
      routes.set('/propensity/predict', () =>
        json({
          predictions: probabilities.map((p, index) => ({
            index,
            label: '1',
            probabilities: p === undefined ? undefined : { '1': p },
          })),
        }),
      );
    }

    function routeSegmentForProducts(recipients: Client[], extra: object = {}) {
      routes.set('/segment-for-products', () =>
        json({
          best_segment: 3,
          buyers: 40,
          segment_total: 100,
          total: recipients.length,
          recipients,
          ...extra,
        }),
      );
    }

    function routeExternalIds(ids: (string | null)[]) {
      // 1) campaign_products, 2) products.externalId
      mock.queueSelect(ids.map((_, i) => ({ productId: BigInt(10 + i) })));
      mock.queueSelect(
        ids
          .filter((x): x is string => Boolean(x))
          .map((externalId) => ({ externalId })),
      );
    }

    it('segmenta por productos, filtra ≥70% y persiste destinatarios', async () => {
      spyFindOne(makeCampaignRow({ id: 5 }));
      routeExternalIds(['ART-1', 'ART-2']);
      routeSegmentForProducts(segRecipients);
      routePropensity([0.9, 0.5, 0.75]);

      const result = await service.generateRecipients(5);

      expect(result).toMatchObject({
        campaignId: 5,
        total: 2,
        segment: 3,
      });
      expect(result.note).toContain('70%');
      expect(result.recipients.map((r) => r.name)).toEqual([
        'Cliente A',
        'Cliente C',
      ]);

      // Se consultó clustering con los external_id y el modo.
      expect(bodyOf('/segment-for-products')).toMatchObject({
        products: ['ART-1', 'ART-2'],
        mode: 'multi',
        auto_fit: true,
      });

      // Se reemplazan los destinatarios.
      expect(mock.state.deletes).toHaveLength(1);
      const inserted = insertedRows(0);
      expect(inserted).toHaveLength(2);
      expect(inserted[0]).toMatchObject({
        campaignId: 5,
        customerId: null,
        cedula: 'A',
        segmento: 3,
        frecuencia: 5,
        monetario: 500,
        ticketPromedio: 100,
        categoriasDistintas: 4,
        propensity: 0.9,
        email: 'ana@test.local',
        phone: '111',
      });
      expect(inserted[1]).toMatchObject({ cedula: 'C', propensity: 0.75 });

      expect(updatedValues()).toMatchObject({
        audienceCount: 2,
        audienceMode: 'auto',
      });
    });

    it('respeta el límite (cap) al persistir', async () => {
      spyFindOne(makeCampaignRow({ id: 5 }));
      routeExternalIds(['ART-1']);
      routeSegmentForProducts(segRecipients);
      routePropensity([0.9, 0.95, 0.99]);

      const result = await service.generateRecipients(5, 1);

      expect(result.total).toBe(1);
      expect(result.recipients.map((r) => r.name)).toEqual(['Cliente C']);
      expect(bodyOf('/segment-for-products').limit).toBe(1);
    });

    it('no filtra si el servicio de propensión está caído', async () => {
      spyFindOne(makeCampaignRow({ id: 5 }));
      routeExternalIds(['ART-1']);
      routeSegmentForProducts(segRecipients);
      routes.set('/propensity/predict', () => json({}, 500));

      const result = await service.generateRecipients(5);

      expect(result.total).toBe(3);
      expect(insertedRows(0).every((r) => r.propensity === null)).toBe(true);
    });

    it('rechaza si el segmento no tiene clientes', async () => {
      spyFindOne(makeCampaignRow({ id: 5 }));
      routeExternalIds(['ART-1']);
      routeSegmentForProducts([]);

      await expect(service.generateRecipients(5)).rejects.toThrow(
        'El mejor segmento para estos productos no tiene clientes',
      );
      expect(mock.state.inserts).toHaveLength(0);
    });

    it('rechaza si ningún cliente supera el 70% de propensión', async () => {
      spyFindOne(makeCampaignRow({ id: 5 }));
      routeExternalIds(['ART-1']);
      routeSegmentForProducts(segRecipients);
      routePropensity([0.1, 0.2, 0.69]);

      await expect(service.generateRecipients(5)).rejects.toThrow(
        'Ningún cliente del segmento supera el 70% de probabilidad de compra',
      );
      expect(mock.state.inserts).toHaveLength(0);
    });

    it('usa el fallback aleatorio cuando los productos no tienen external_id', async () => {
      spyFindOne(makeCampaignRow({ id: 5 }));
      // campaign_products existe pero products.externalId es null.
      mock.queueSelect([{ productId: 10n }]);
      mock.queueSelect([]);
      // Pool de customers.
      mock.queueSelect([
        {
          id: 21n,
          documentNumber: '010203',
          name: 'Ana Pérez',
          email: 'ana@test.local',
          phone: '',
        },
      ]);

      const result = await service.generateRecipients(5);

      expect(result).toMatchObject({ total: 1, segment: null });
      expect(result.note).toContain('Recomendación aleatoria');
      expect(result.recipients[0]).toEqual({
        id: 21,
        name: 'Ana Pérez',
        email: 'ana@test.local',
        phone: null,
      });
      expect(insertedRow(0)).toMatchObject({
        customerId: 21,
        cedula: '010203',
        segmento: null,
        propensity: null,
      });
      expect(updatedValues()).toMatchObject({
        audienceCount: 1,
        audienceMode: 'auto',
      });
    });

    it('rechaza si el pool aleatorio está vacío', async () => {
      spyFindOne(makeCampaignRow({ id: 5 }));
      mock.queueSelect([]); // campaign_products vacío
      mock.queueSelect([]); // customers vacío

      await expect(service.generateRecipients(5)).rejects.toThrow(
        'No hay clientes disponibles para recomendar',
      );
    });

    it('segmenta un cluster explícito (modo manual)', async () => {
      spyFindOne(makeCampaignRow({ id: 5 }));
      routes.set('/assign-from-db', () => json({ ids: ['010203', '040506'] }));
      mock.queueSelect([
        {
          id: 31n,
          documentNumber: '010203',
          name: 'Ana',
          email: 'ana@test.local',
          phone: '300',
        },
        {
          id: 32n,
          documentNumber: '040506',
          name: null,
          email: 'beto@test.local',
          phone: null,
        },
      ]);

      const result = await service.generateRecipients(5, 500, 2, 'seg_v2');

      expect(bodyOf('/assign-from-db')).toEqual({
        model_name: 'seg_v2',
        query: 'SELECT * FROM analytics.vw_rfm_clientes',
        id_column: 'cliente_cod',
        label: 2,
      });
      expect(result).toMatchObject({ total: 2, segment: 2 });
      expect(result.note).toContain('cluster 2');
      expect(insertedRows(0)[0]).toMatchObject({
        segmento: 2,
        cedula: '010203',
      });
      expect(insertedRows(0)[1]).toMatchObject({
        segmento: 2,
        name: null,
        phone: null,
      });
    });

    it('rechaza un cluster sin clientes asignados', async () => {
      spyFindOne(makeCampaignRow({ id: 5 }));
      routes.set('/assign-from-db', () => json({ ids: [] }));

      await expect(service.generateRecipients(5, 500, 7)).rejects.toThrow(
        'El segmento 7 no tiene clientes asignados',
      );
    });

    it('rechaza si el cluster no tiene clientes con contacto', async () => {
      spyFindOne(makeCampaignRow({ id: 5 }));
      routes.set('/assign-from-db', () => json({ ids: ['X'] }));
      mock.queueSelect([]);

      await expect(service.generateRecipients(5, 500, 2)).rejects.toThrow(
        'No hay clientes disponibles para recomendar',
      );
    });

    it('añade cédulas manuales evitando duplicados por email/teléfono', async () => {
      spyFindOne(makeCampaignRow({ id: 5 }));
      routeExternalIds(['ART-1']);
      routeSegmentForProducts([segRecipients[0]]);
      routePropensity([0.9]);
      routes.set('/segment-clients', () =>
        json({
          total: 3,
          clients: [
            // Duplicado por email (ignorado).
            makeClient('A', { email: 'ANA@TEST.LOCAL', phone: '999' }),
            // Duplicado por teléfono (ignorado).
            makeClient('X', { email: 'nuevo@test.local', phone: '111' }),
            // Nuevo.
            makeClient('Z', {
              email: 'zoe@test.local',
              phone: '777',
              segment: 4,
            }),
          ],
        }),
      );

      const result = await service.generateRecipients(
        5,
        500,
        undefined,
        undefined,
        'multi',
        ['A', 'X', 'Z', 'Z'],
      );

      expect(filterCedulas(callsTo('/segment-clients')[0].body)).toEqual([
        'A',
        'X',
        'Z',
      ]);
      expect(result.total).toBe(2);
      expect(result.note).toContain('añadidos manualmente');
      const inserted = insertedRows(0);
      expect(inserted.map((r) => r.cedula)).toEqual(['A', 'Z']);
      expect(inserted[1]).toMatchObject({
        cedula: 'Z',
        segmento: 4,
        email: 'zoe@test.local',
      });
      expect(updatedValues()).toMatchObject({
        audienceCount: 2,
        audienceMode: 'mixed',
      });
    });
  });

  /* ── scoreClients ─────────────────────────────────────── */

  describe('scoreClients', () => {
    const all: Client[] = [
      makeClient('A', { segment: 1 }),
      makeClient('B', { segment: 2 }),
      makeClient('C', { segment: 3 }),
    ];

    function setupScores(
      opts: {
        propensity?: number[];
        uplift?: number[];
        contacts?: Client[];
      } = {},
    ) {
      routes.set('/segment-clients', (body) =>
        filterCedulas(body)
          ? json({ total: 0, clients: opts.contacts ?? [] })
          : json({ total: all.length, clients: all }),
      );
      routes.set('/propensity/predict', () =>
        json({
          predictions: (opts.propensity ?? [0.9, 0.4, 0.95]).map(
            (p, index) => ({
              index,
              label: '1',
              probabilities: { '1': p },
            }),
          ),
        }),
      );
      routes.set('/uplift/predict', () =>
        json({
          predictions: (opts.uplift ?? [0.1, 0.2, 0.3]).map((u, index) => ({
            index,
            uplift_score: u,
            percentile: 10 * (index + 1),
          })),
        }),
      );
    }

    it('convierte filtros a snake_case y pide el conjunto completo sin contactos', async () => {
      setupScores();

      await service.scoreClients({
        filters: {
          minFrecuencia: 2,
          ciudades: ['Cali'],
          barrios: [],
          direccionContiene: '',
          segment: 1,
        },
        limit: 10,
      });

      const body = bodyOf('/segment-clients');
      expect(body).toMatchObject({
        filters: {
          min_frecuencia: 2,
          ciudades: ['Cali'],
          segment: 1,
        },
        offset: 0,
        limit: 100000,
        with_contacts: false,
      });
      expect(body.filters).not.toHaveProperty('direccion_contiene');
      expect(body.filters).not.toHaveProperty('barrios');
    });

    it('filtra por propensión, excluye cédulas y pagina', async () => {
      setupScores({ contacts: [makeClient('C', { consent_email: true })] });

      const result = await service.scoreClients({
        minPropensity: 0.5,
        excludeCedulas: ['A'],
        limit: 1,
        offset: 0,
      });

      expect(result.total).toBe(1);
      expect(result.clients).toHaveLength(1);
      expect(result.clients[0]).toMatchObject({
        cedula: 'C',
        propensity: 0.95,
        uplift: 0.3,
        percentile: 30,
        consent_email: true,
        consent_whatsapp: false,
        consent_sms: false,
      });
      // Solo se piden contactos de la página.
      expect(filterCedulas(callsTo('/segment-clients')[1].body)).toEqual(['C']);
      expect(bodyOf('/segment-clients', 1).with_contacts).toBe(true);
    });

    it('ordena por propensión descendente por defecto', async () => {
      setupScores();

      const result = await service.scoreClients({ limit: 10 });

      expect(result.clients.map((c) => c.cedula)).toEqual(['C', 'A', 'B']);
    });

    it('ordena por cédula ascendente', async () => {
      setupScores();

      const result = await service.scoreClients({
        sort: 'cedula',
        dir: 'asc',
      });

      expect(result.clients.map((c) => c.cedula)).toEqual(['A', 'B', 'C']);
    });

    it('ordena por uplift descendente', async () => {
      setupScores();

      const result = await service.scoreClients({
        sort: 'uplift',
        dir: 'desc',
      });

      expect(result.clients.map((c) => c.cedula)).toEqual(['C', 'B', 'A']);
    });

    it('ordena por segmento descendente', async () => {
      setupScores();

      const result = await service.scoreClients({
        sort: 'segment',
        dir: 'desc',
      });

      expect(result.clients.map((c) => c.cedula)).toEqual(['C', 'B', 'A']);
    });

    it('clampa el límite inferior a 1', async () => {
      setupScores();

      const result = await service.scoreClients({ limit: 0 });

      expect(result.clients).toHaveLength(1);
      expect(result.total).toBe(3);
    });

    it('reutiliza los scores en caché para los mismos filtros', async () => {
      setupScores();

      await service.scoreClients({ filters: { minFrecuencia: 1 } });
      await service.scoreClients({ filters: { minFrecuencia: 1 } });

      expect(callsTo('/propensity/predict')).toHaveLength(1);
      expect(callsTo('/uplift/predict')).toHaveLength(1);
    });

    it('devuelve propensión 0 si los servicios de scoring fallan', async () => {
      setupScores();
      routes.set('/propensity/predict', () => json({}, 500));
      routes.set('/uplift/predict', () => json({}, 500));

      const result = await service.scoreClients({ limit: 10 });

      expect(result.clients.every((c) => c.propensity === 0)).toBe(true);
      expect(result.clients.every((c) => c.uplift === 0)).toBe(true);
    });

    it('propaga el fallo de clustering-api', async () => {
      routes.set('/segment-clients', () => json({ detail: 'boom' }, 500));

      await expect(service.scoreClients({})).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  /* ── addManualRecipients ──────────────────────────────── */

  describe('addManualRecipients', () => {
    function routeClients(clients: Client[]) {
      routes.set('/segment-clients', () =>
        json({ total: clients.length, clients }),
      );
    }

    it('lanza error sin filtros ni cédulas', async () => {
      spyFindOne(makeCampaignRow({ id: 5 }));

      await expect(service.addManualRecipients(5)).rejects.toThrow(
        'Para la audiencia manual define filtros o envía la lista de cédulas',
      );
    });

    it('lanza error si las cédulas vienen vacías', async () => {
      spyFindOne(makeCampaignRow({ id: 5 }));

      await expect(service.addManualRecipients(5, ['  ', ''])).rejects.toThrow(
        'No se recibieron cédulas válidas',
      );
    });

    it('lanza error si ninguna cédula coincide', async () => {
      spyFindOne(makeCampaignRow({ id: 5 }));
      routeClients([]);

      await expect(
        service.addManualRecipients(5, ['NOEXISTE']),
      ).rejects.toThrow('Ninguna cédula coincide con la base de clientes');
    });

    it('lanza error si ningún cliente cumple los filtros', async () => {
      spyFindOne(makeCampaignRow({ id: 5 }));
      routeClients([]);

      await expect(
        service.addManualRecipients(5, undefined, { minEdad: 99 }),
      ).rejects.toThrow('Ningún cliente cumple los filtros seleccionados');
    });

    it('deduplica contra los existentes y pasa la audiencia a mixed', async () => {
      spyFindOne(makeCampaignRow({ id: 5 }), { id: 5, audienceMode: 'mixed' });
      routeClients([
        makeClient('A'),
        makeClient('B', { email: 'ANA@TEST.LOCAL', phone: '999' }),
        makeClient('C', { email: 'carla@test.local', phone: '300A' }),
        makeClient('D', { email: 'dora@test.local', phone: '444' }),
      ]);
      // Destinatarios ya guardados.
      mock.queueSelect([
        { email: 'ana@test.local', phone: '300A', cedula: 'A' },
      ]);
      // audienceMode actual de la campaña.
      mock.queueSelect([{ audienceMode: 'auto' }]);

      const result = await service.addManualRecipients(5, ['A', 'B', 'C', 'D']);

      expect(filterCedulas(callsTo('/segment-clients')[0].body)).toEqual([
        'A',
        'B',
        'C',
        'D',
      ]);
      expect(bodyOf('/segment-clients').with_contacts).toBe(true);
      const inserted = insertedRows(0);
      expect(inserted.map((r) => r.cedula)).toEqual(['D']);
      expect(inserted[0]).toMatchObject({
        campaignId: 5,
        customerId: null,
        cedula: 'D',
        propensity: null,
      });
      expect(updatedValues()).toMatchObject({
        audienceMode: 'mixed',
        audienceCount: 2,
      });
      expect(updatedValues().updatedAt).toEqual(expect.any(String));
      expect(result).toMatchObject({ audienceMode: 'mixed' });
    });

    it('mantiene la audiencia manual si ya lo era', async () => {
      spyFindOne(makeCampaignRow({ id: 5 }), { id: 5 });
      routeClients([makeClient('Z')]);
      mock.queueSelect([]);
      mock.queueSelect([{ audienceMode: 'manual' }]);

      await service.addManualRecipients(5, ['Z']);

      expect(updatedValues().audienceMode).toBe('manual');
    });

    it('no actualiza nada si todos los clientes ya estaban', async () => {
      spyFindOne(makeCampaignRow({ id: 5 }), { id: 5 });
      routeClients([makeClient('A')]);
      mock.queueSelect([{ email: 'A@TEST.LOCAL', phone: null, cedula: 'A' }]);

      await service.addManualRecipients(5, ['A']);

      expect(mock.state.inserts).toHaveLength(0);
      expect(mock.state.updates).toHaveLength(0);
    });
  });

  /* ── replaceManualRecipients ──────────────────────────── */

  describe('replaceManualRecipients', () => {
    it('reemplaza todo el público y deja modo manual', async () => {
      spyFindOne(makeCampaignRow({ id: 5 }), { id: 5 });
      routes.set('/segment-clients', () =>
        json({
          total: 2,
          clients: [
            makeClient('A', {
              segment: 2,
              features: {
                frecuencia: 3,
                monetario: 150,
                ticket_promedio: 50,
                categorias_distintas: 4,
              },
            }),
            makeClient('B'),
          ],
        }),
      );
      mock.queueSelect([{ id: 1n }]);

      await service.replaceManualRecipients(5, ['A', 'B']);

      // Borra los destinatarios previos.
      expect(mock.state.deletes).toHaveLength(1);
      const inserted = insertedRows(0);
      expect(inserted).toHaveLength(2);
      expect(inserted[0]).toMatchObject({
        campaignId: 5,
        cedula: 'A',
        segmento: 2,
        frecuencia: 3,
        monetario: 150,
        ticketPromedio: 50,
        categoriasDistintas: 4,
        propensity: null,
      });
      expect(updatedValues()).toMatchObject({
        audienceCount: 2,
        audienceMode: 'manual',
      });
    });
  });

  /* ── applyAudience / useRecommendedAudience ───────────── */

  describe('applyAudience', () => {
    it('modo manual delega en replaceManualRecipients', async () => {
      spyFindOne(makeCampaignRow({ id: 5 }), { id: 5 });
      const replace = vi
        .spyOn(service, 'replaceManualRecipients')
        .mockResolvedValue({} as CampaignView);
      const generate = vi.spyOn(service, 'generateRecipients');

      const result = await service.applyAudience(5, 'manual', ['A'], {
        minEdad: 18,
      });

      expect(replace).toHaveBeenCalledWith(5, ['A'], { minEdad: 18 });
      expect(generate).not.toHaveBeenCalled();
      expect(result).toEqual({ id: 5 });
    });

    it('modo auto re-segmenta con el modo de la campaña', async () => {
      spyFindOne(makeCampaignRow({ id: 5, mode: 'bundle' }), { id: 5 });
      const generate = vi
        .spyOn(service, 'generateRecipients')
        .mockResolvedValue({} as GenerateResult);
      const add = vi.spyOn(service, 'addManualRecipients');

      await service.applyAudience(5, 'auto');

      expect(generate).toHaveBeenCalledWith(
        5,
        100000,
        undefined,
        undefined,
        'bundle',
      );
      expect(add).not.toHaveBeenCalled();
    });

    it('modo mixed re-segmenta y añade la audiencia manual', async () => {
      spyFindOne(makeCampaignRow({ id: 5, mode: 'multi' }), { id: 5 });
      const generate = vi
        .spyOn(service, 'generateRecipients')
        .mockResolvedValue({} as GenerateResult);
      const add = vi
        .spyOn(service, 'addManualRecipients')
        .mockResolvedValue({} as CampaignView);

      await service.applyAudience(5, 'mixed', ['A'], { ciudades: ['Cali'] });

      expect(generate).toHaveBeenCalledWith(
        5,
        100000,
        undefined,
        undefined,
        'multi',
      );
      expect(add).toHaveBeenCalledWith(5, ['A'], { ciudades: ['Cali'] });
    });
  });

  describe('useRecommendedAudience', () => {
    it('re-segmenta y devuelve la campaña recargada', async () => {
      spyFindOne(makeCampaignRow({ id: 5, mode: 'multi' }), { id: 5 });
      const generate = vi
        .spyOn(service, 'generateRecipients')
        .mockResolvedValue({} as GenerateResult);

      const result = await service.useRecommendedAudience(5);

      expect(generate).toHaveBeenCalledWith(
        5,
        100000,
        undefined,
        undefined,
        'multi',
      );
      expect(result).toEqual({ id: 5 });
    });
  });

  /* ── clientFilterOptions ──────────────────────────────── */

  describe('clientFilterOptions', () => {
    it('hace GET autenticado y devuelve las opciones', async () => {
      routes.set('/client-filter-options', () => json({ ciudades: ['Cali'] }));

      await expect(service.clientFilterOptions()).resolves.toEqual({
        ciudades: ['Cali'],
      });

      const [call] = callsTo('/client-filter-options');
      expect(call.method).toBe('GET');
      const headers = call.headers as Record<string, string>;
      expect(Object.keys(headers)).toContain('X-Admin-Key');
      expect(typeof headers['X-Admin-Key']).toBe('string');
    });

    it('traduce un fallo de red a BadRequest', async () => {
      routes.set('/client-filter-options', () => {
        throw new Error('ECONNREFUSED');
      });

      await expect(service.clientFilterOptions()).rejects.toThrow(
        'El servicio de segmentación (clustering-api) no está disponible',
      );
    });

    it('traduce una respuesta no-ok a BadRequest', async () => {
      routes.set('/client-filter-options', () => json({ error: 'x' }, 500));

      await expect(service.clientFilterOptions()).rejects.toThrow(
        'El servicio de segmentación no pudo completar la operación',
      );
    });
  });

  /* ── generateContent ──────────────────────────────────── */

  describe('generateContent', () => {
    it('completa nombre/precio desde la BD y arma el payload', async () => {
      mock.queueSelect([{ id: 10n, name: 'Café', price: 5000 }]);
      routes.set('/generate', () => json({ whatsapp: 'Hola' }));

      expect(
        await service.generateContent({
          products: [{ id: 10 }, { name: 'Pan', price: 300 }],
          channels: ['whatsapp', 'email'],
          discount: 10,
        }),
      ).toEqual({ whatsapp: 'Hola' });
      expect(bodyOf('/generate')).toEqual({
        producto: { nombre: 'Café', precio: 5000, descuento: 10 },
        productos: [
          { nombre: 'Café', precio: 5000, descuento: 10 },
          { nombre: 'Pan', precio: 300, descuento: 10 },
        ],
        prompt: '',
        tono: 'cercano',
        canales: ['whatsapp', 'email'],
      });
    });

    it('usa productId/productName/price cuando no hay lista', async () => {
      routes.set('/generate', () => json({ sms: 'Promo' }));

      await service.generateContent({
        productId: 11,
        productName: 'Arroz',
        price: 2000,
        channels: ['sms'],
      });

      expect(mock.db.select).not.toHaveBeenCalled();
      expect(bodyOf('/generate').producto).toEqual({
        nombre: 'Arroz',
        precio: 2000,
        descuento: null,
      });
    });

    it('usa valores por defecto sin productos', async () => {
      routes.set('/generate', () => json({}));

      await service.generateContent({ channels: ['email'] });

      expect(bodyOf('/generate')).toMatchObject({
        producto: { nombre: 'producto', precio: null, descuento: null },
        productos: [],
        tono: 'cercano',
      });
    });

    it('traduce el fallo de red a BadRequest', async () => {
      routes.set('/generate', () => {
        throw new Error('ECONNREFUSED');
      });

      await expect(
        service.generateContent({ channels: ['whatsapp'] }),
      ).rejects.toThrow(
        'El servicio de IA de campañas (/ia-service) no está disponible',
      );
    });

    it('traduce una respuesta no-ok a BadRequest', async () => {
      routes.set('/generate', () => json({ detail: 'boom' }, 500));

      await expect(
        service.generateContent({ channels: ['whatsapp'] }),
      ).rejects.toThrow('El servicio de IA no pudo generar el contenido');
    });
  });

  /* ── suggestName ──────────────────────────────────────── */

  describe('suggestName', () => {
    it('filtra productos sin nombre y normaliza espacios', async () => {
      routes.set('/suggest-name', () => json({ nombre: '  Oferta de café  ' }));

      const result = await service.suggestName({
        products: [{ name: ' Café ' }, { name: '   ' }, { price: 100 }],
        prompt: 'verano',
      });

      expect(result).toEqual({ name: 'Oferta de café' });
      expect(bodyOf('/suggest-name')).toEqual({
        productos: [{ nombre: 'Café', precio: null }],
        prompt: 'verano',
      });
    });

    it('rechaza si la IA no devuelve nombre', async () => {
      routes.set('/suggest-name', () => json({}));

      await expect(service.suggestName({ products: [] })).rejects.toThrow(
        'El servicio de IA no devolvió un nombre para la campaña',
      );
    });

    it('rechaza si el nombre no es una cadena', async () => {
      routes.set('/suggest-name', () => json({ nombre: 42 }));

      await expect(service.suggestName({})).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('traduce el fallo de red a BadRequest', async () => {
      routes.set('/suggest-name', () => {
        throw new Error('ECONNREFUSED');
      });

      await expect(service.suggestName({})).rejects.toThrow(
        'El servicio de IA de campañas (/ia-service) no está disponible',
      );
    });

    it('traduce una respuesta no-ok a BadRequest', async () => {
      routes.set('/suggest-name', () => json({}, 500));

      await expect(service.suggestName({})).rejects.toThrow(
        'El servicio de IA no pudo sugerir el nombre de la campaña',
      );
    });
  });

  /* ── interpretSegment ─────────────────────────────────── */

  describe('interpretSegment', () => {
    it('reenvía el DTO tal cual al servicio de IA', async () => {
      routes.set('/interpret', () =>
        json({ explanation: 'Porque compran café' }),
      );
      const dto = {
        mode: 'multi' as const,
        productNames: ['Café'],
        bestSegment: 3,
        total: 10,
      };

      await expect(service.interpretSegment(dto)).resolves.toEqual({
        explanation: 'Porque compran café',
      });
      expect(bodyOf('/interpret')).toEqual(dto);
    });

    it('traduce el fallo de red a BadRequest', async () => {
      routes.set('/interpret', () => {
        throw new Error('ECONNREFUSED');
      });

      await expect(service.interpretSegment({})).rejects.toThrow(
        'El servicio de IA (/ia-service) no está disponible',
      );
    });

    it('traduce una respuesta no-ok a BadRequest', async () => {
      routes.set('/interpret', () => json({}, 500));

      await expect(service.interpretSegment({})).rejects.toThrow(
        'El servicio de IA no pudo interpretar la segmentación',
      );
    });
  });

  /* ── segmentPreviewStream (SSE) ───────────────────────── */

  describe('segmentPreviewStream', () => {
    async function collect(
      observable: ReturnType<CampaignsService['segmentPreviewStream']>,
    ): Promise<PreviewEvent[]> {
      const events: PreviewEvent[] = [];
      await new Promise<void>((resolve, reject) => {
        observable.subscribe({
          next: (e) => events.push(e as unknown as PreviewEvent),
          error: (err: unknown) =>
            reject(err instanceof Error ? err : new Error(String(err))),
          complete: () => resolve(),
        });
      });
      return events;
    }

    function lastEvent(events: PreviewEvent[]): PreviewEvent {
      return events[events.length - 1];
    }

    it('emite error si los productos no tienen external_id', async () => {
      mock.queueSelect([]);

      const events = await collect(service.segmentPreviewStream([1, 2]));

      expect(events).toEqual([
        {
          data: {
            stage: 'error',
            error:
              'Los productos seleccionados no tienen external_id en la réplica',
          },
        },
      ]);
    });

    it('re-emite etapas y filtra destinatarios con ≥70% de propensión', async () => {
      mock.queueSelect([{ externalId: 'ART-1' }]);
      routes.set('/segment-for-products', () =>
        sse([
          { stage: 'fit', message: 'Entrenando', progress: 40 },
          'data: esto-no-es-json',
          {
            stage: 'done',
            result: {
              best_segment: 3,
              segment_total: 100,
              buyers: 40,
              mode: 'multi',
              recipients: [makeClient('A'), makeClient('B'), makeClient('C')],
            },
          },
        ]),
      );
      routes.set('/propensity/predict', () =>
        json({
          predictions: [0.9, 0.5, 0.75].map((p, index) => ({
            index,
            label: '1',
            probabilities: { '1': p },
          })),
        }),
      );
      routes.set('/uplift/predict', () =>
        json({
          predictions: [
            { index: 0, uplift_score: 0.1, percentile: 10 },
            { index: 1, uplift_score: 0.2, percentile: 20 },
            { index: 2, uplift_score: 0.3, percentile: 30 },
          ],
        }),
      );

      const events = await collect(
        service.segmentPreviewStream([1], 500, 'bundle'),
      );

      expect(events.map((e) => e.data.stage)).toEqual([
        'fit',
        'xgboost',
        'uplift',
        'filter',
        'done',
      ]);

      // La petición lleva los external_id y el modo.
      expect(bodyOf('/segment-for-products')).toMatchObject({
        products: ['ART-1'],
        mode: 'bundle',
        stream: true,
        limit: 500,
      });

      const done = lastEvent(events).data.result;
      expect(done).toMatchObject({
        segment: 3,
        segmentTotal: 100,
        total: 2,
        buyers: 40,
        mode: 'multi',
        bundleFallback: false,
      });
      expect(done?.recipients.map((r) => r.cedula)).toEqual(['A', 'C']);
      expect(done?.recipients[0]).toMatchObject({
        cedula: 'A',
        propensity: 0.9,
        uplift: 0.1,
        percentile: 10,
      });
    });

    it('emite error si el servicio de segmentación responde no-ok', async () => {
      mock.queueSelect([{ externalId: 'ART-1' }]);
      routes.set('/segment-for-products', () => json({}, 503));

      const events = await collect(service.segmentPreviewStream([1]));

      expect(events).toEqual([
        {
          data: {
            stage: 'error',
            error: 'El servicio de segmentación respondió 503',
          },
        },
      ]);
    });

    it('emite error si la petición falla', async () => {
      mock.queueSelect([{ externalId: 'ART-1' }]);
      routes.set('/segment-for-products', () => {
        throw new Error('ECONNREFUSED');
      });

      const events = await collect(service.segmentPreviewStream([1]));

      expect(events).toEqual([
        {
          data: {
            stage: 'error',
            error: 'No se pudo completar la segmentación',
          },
        },
      ]);
    });
  });
});
