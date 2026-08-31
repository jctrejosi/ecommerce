import {
  BadRequestException,
  Injectable,
  Logger,
  MessageEvent,
  NotFoundException,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { DrizzleService } from '../../database/drizzle.service';
import {
  campaignMessages,
  campaignProducts,
  campaignRecipients,
  campaigns,
  customers,
  products,
} from '../../../drizzle/schema';
import {
  CampaignMessageDto,
  CreateCampaignDto,
  UpdateCampaignDto,
} from './dto/campaign.dto';

const CHANNELS = ['whatsapp', 'email', 'sms'] as const;
type Channel = (typeof CHANNELS)[number];

interface SegRecipient {
  cedula: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  segment?: number;
  features?: {
    frecuencia?: number;
    monetario?: number;
    ticket_promedio?: number;
    categorias_distintas?: number;
  };
}

@Injectable()
export class CampaignsService {
  private readonly logger = new Logger(CampaignsService.name);

  constructor(private readonly drizzle: DrizzleService) {}

  private get db() {
    return this.drizzle.db;
  }

  private iaServiceUrl(): string {
    return process.env.IA_SERVICE_URL ?? 'http://127.0.0.1:8002';
  }

  private clusteringApiUrl(): string {
    return process.env.CLUSTERING_API_URL ?? 'http://127.0.0.1:8010';
  }

  private clusteringApiKey(): string {
    return process.env.CLUSTERING_API_KEY ?? 'change-me';
  }

  private clusteringModelName(): string {
    return process.env.CLUSTERING_MODEL_NAME ?? 'seg_rfm_v1';
  }

  private xgboostApiUrl(): string {
    return process.env.XGBOOST_API_URL ?? 'http://127.0.0.1:8011';
  }

  private xgboostModel(): string {
    return process.env.XGBOOST_PROPENSITY_MODEL ?? 'prop_activo';
  }

  private upliftApiUrl(): string {
    return process.env.UPLIFT_API_URL ?? 'http://127.0.0.1:8012';
  }

  private upliftModel(): string {
    return process.env.UPLIFT_MODEL ?? 'uplift_dr_learner';
  }

  // Vista RFM de la réplica de analytics (cédula + features). El clustering
  // la lee server-side y devuelve ids (= cédula/NIT) + labels.
  private readonly RFM_QUERY = 'SELECT * FROM analytics.vw_rfm_clientes';
  private readonly RFM_ID_COLUMN = 'cliente_cod';

  /* ── Helpers de serialización (bigint → number) ─── */

  private toCampaign(row: typeof campaigns.$inferSelect) {
    return {
      ...row,
      id: Number(row.id),
      productId: row.productId == null ? null : Number(row.productId),
      createdBy: row.createdBy == null ? null : Number(row.createdBy),
    };
  }

  private toMessage(row: typeof campaignMessages.$inferSelect) {
    return { ...row, id: Number(row.id) };
  }

  private toRecipient(row: typeof campaignRecipients.$inferSelect) {
    return {
      ...row,
      id: Number(row.id),
      customerId: row.customerId == null ? null : Number(row.customerId),
    };
  }

  /* ── CRUD ───────────────────────────────────────────── */

  async list(status?: string) {
    const rows = await this.db
      .select()
      .from(campaigns)
      .where(
        and(
          isNull(campaigns.deletedAt),
          status ? eq(campaigns.status, status as never) : undefined,
        ),
      )
      .orderBy(desc(campaigns.updatedAt));

    const messages = rows.length
      ? await this.db
          .select()
          .from(campaignMessages)
          .where(
            sql`${campaignMessages.campaignId} = ANY(${sql`ARRAY[${sql.join(
              rows.map((r) => Number(r.id)),
              sql`, `,
            )}]::bigint[]`})`,
          )
      : [];

    const productsById = await this.loadProducts(rows.map((r) => r.productId));
    const campaignProductsById = await this.loadCampaignProducts(
      rows.map((r) => Number(r.id)),
    );

    return rows.map((c) => {
      const products = (campaignProductsById.get(Number(c.id)) ?? [])
        .map((pid) => productsById.get(pid) ?? null)
        .filter((p): p is { id: number; name: string } => p !== null);
      return {
        ...this.toCampaign(c),
        product:
          c.productId != null
            ? (productsById.get(Number(c.productId)) ?? null)
            : null,
        products,
        messages: messages
          .filter((m) => Number(m.campaignId) === Number(c.id))
          .map((m) => this.toMessage(m)),
      };
    });
  }

  async findOne(id: number) {
    const [row] = await this.db
      .select()
      .from(campaigns)
      .where(and(eq(campaigns.id, BigInt(id)), isNull(campaigns.deletedAt)));
    if (!row) throw new NotFoundException('Campaña no encontrada');

    const messages = await this.db
      .select()
      .from(campaignMessages)
      .where(eq(campaignMessages.campaignId, id))
      .orderBy(asc(campaignMessages.id));

    const [product] = row.productId != null
      ? await this.db
          .select({ id: products.id, name: products.name })
          .from(products)
          .where(eq(products.id, BigInt(row.productId)))
      : [null];

    const campaignProductIds = (
      await this.db
        .select({ productId: campaignProducts.productId })
        .from(campaignProducts)
        .where(eq(campaignProducts.campaignId, id))
        .orderBy(asc(campaignProducts.position))
    ).map((r) => Number(r.productId));

    const productRows = campaignProductIds.length
      ? await this.db
          .select({ id: products.id, name: products.name })
          .from(products)
          .where(
            sql`${products.id} = ANY(${sql`ARRAY[${sql.join(
              campaignProductIds.map((v) => BigInt(v)),
              sql`, `,
            )}]::bigint[]`})`,
          )
      : [];
    const productListById = new Map(
      productRows.map((p) => [Number(p.id), { id: Number(p.id), name: p.name }]),
    );

    const recipientsCount = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(campaignRecipients)
      .where(eq(campaignRecipients.campaignId, id));

    return {
      ...this.toCampaign(row),
      product: product ? { id: Number(product.id), name: product.name } : null,
      products: campaignProductIds
        .map((pid) => productListById.get(pid) ?? null)
        .filter((p): p is { id: number; name: string } => p !== null),
      messages: messages.map((m) => this.toMessage(m)),
      recipientsCount: recipientsCount[0]?.count ?? 0,
    };
  }

  async create(dto: CreateCampaignDto, userId?: number) {
    const productIds = dto.productIds?.length
      ? dto.productIds
      : dto.productId != null
        ? [dto.productId]
        : [];
    const [row] = await this.db
      .insert(campaigns)
      .values({
        name: dto.name,
        productId: productIds[0] ?? null,
        prompt: dto.prompt ?? null,
        tone: dto.tone ?? null,
        channels: dto.channels ?? [],
        createdBy: userId ?? null,
      })
      .returning();

    await this.upsertCampaignProducts(Number(row.id), productIds);
    await this.upsertMessages(Number(row.id), dto.messages ?? []);
    return this.findOne(Number(row.id));
  }

  async update(id: number, dto: UpdateCampaignDto) {
    const existing = await this.findOne(id);

    let productId = dto.productId ?? existing.productId;
    if (dto.productIds) {
      const ids = [...new Set(dto.productIds)];
      await this.upsertCampaignProducts(id, ids);
      productId = ids[0] ?? existing.productId;
    }

    const [row] = await this.db
      .update(campaigns)
      .set({
        name: dto.name ?? existing.name,
        productId,
        prompt: dto.prompt ?? existing.prompt,
        tone: dto.tone ?? existing.tone,
        channels: dto.channels ?? existing.channels,
        status: (dto.status as never) ?? existing.status,
        scheduledAt: dto.scheduledAt ?? existing.scheduledAt,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(campaigns.id, BigInt(id)))
      .returning();
    if (!row) throw new NotFoundException('Campaña no encontrada');

    if (dto.messages) await this.upsertMessages(id, dto.messages);
    return this.findOne(id);
  }

  async remove(id: number) {
    await this.findOne(id);
    await this.db
      .update(campaigns)
      .set({ deletedAt: new Date().toISOString() })
      .where(eq(campaigns.id, BigInt(id)));
    return { success: true };
  }

  /* ── Mensajes por canal ─────────────────────────────── */

  private async upsertMessages(campaignId: number, messages: CampaignMessageDto[]) {
    for (const m of messages) {
      await this.db
        .insert(campaignMessages)
        .values({
          campaignId,
          channel: m.channel,
          subject: m.subject ?? null,
          content: m.content ?? null,
          html: m.html ?? null,
          emailBlocks: (m.emailBlocks as object) ?? null,
        })
        .onConflictDoNothing();
    }
  }

  /* ── Productos de la campaña (multi-selección) ────────── */

  private async upsertCampaignProducts(
    campaignId: number,
    productIds: number[],
  ) {
    await this.db
      .delete(campaignProducts)
      .where(eq(campaignProducts.campaignId, campaignId));
    if (!productIds.length) return;
    await this.db.insert(campaignProducts).values(
      [...new Set(productIds)].map((pid, i) => ({
        campaignId,
        productId: pid,
        position: i,
      })),
    );
  }

  private async loadCampaignProducts(campaignIds: number[]) {
    const map = new Map<number, number[]>();
    if (!campaignIds.length) return map;
    const rows = await this.db
      .select({
        campaignId: campaignProducts.campaignId,
        productId: campaignProducts.productId,
        position: campaignProducts.position,
      })
      .from(campaignProducts)
      .where(
        sql`${campaignProducts.campaignId} = ANY(${sql`ARRAY[${sql.join(
          campaignIds,
          sql`, `,
        )}]::bigint[]`})`,
      )
      .orderBy(asc(campaignProducts.position));
    for (const r of rows) {
      const list = map.get(Number(r.campaignId)) ?? [];
      list.push(Number(r.productId));
      map.set(Number(r.campaignId), list);
    }
    return map;
  }

  /* ── Recomendación de clientes (segmentación inteligente) ──
     Con `segment` llama a clustering-api y mapea cédulas → clientes.
     Sin `segment` mantiene el fallback aleatorio. */

  async listRecipients(id: number) {
    await this.findOne(id);
    const rows = await this.db
      .select()
      .from(campaignRecipients)
      .where(eq(campaignRecipients.campaignId, id))
      .orderBy(asc(campaignRecipients.id));
    return rows.map((r) => this.toRecipient(r));
  }

  /**
   * POST genérico a clustering-api (protegido con X-Admin-Key).
   */
  private async postToClustering(path: string, body: Record<string, unknown>) {
    const url = `${this.clusteringApiUrl()}${path}`;
    let resp: Response;
    try {
      resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Admin-Key': this.clusteringApiKey(),
        },
        body: JSON.stringify(body),
      });
    } catch (e) {
      this.logger.error(`No se pudo contactar clustering-api en ${url}: ${e}`);
      throw new BadRequestException(
        'El servicio de segmentación (clustering-api) no está disponible',
      );
    }
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      this.logger.error(`clustering-api respondió ${resp.status}: ${text}`);
      throw new BadRequestException(
        'El servicio de segmentación no pudo completar la operación',
      );
    }
    return resp.json();
  }

  /**
   * Consulta a clustering-api las cédulas (cliente_cod) que pertenecen a un
   * cluster. Devuelve la lista de cédulas para mapearlas a `customers`.
   */
  private async fetchSegmentCedulas(
    segment: number,
    modelName?: string,
  ): Promise<string[]> {
    const data = (await this.postToClustering('/assign-from-db', {
      model_name: modelName ?? this.clusteringModelName(),
      query: this.RFM_QUERY,
      id_column: this.RFM_ID_COLUMN,
      label: segment,
    })) as { ids?: unknown[] };
    return (data.ids ?? []).map((v) => String(v));
  }

  /**
   * Evalúa en clustering-api el mejor segmento para los productos de la
   * campaña. Con `auto_fit: true` entrena el modelo si aún no existe.
   */
  private async segmentForProducts(
    modelName: string | undefined,
    products: string[],
    limit?: number,
    mode?: 'multi' | 'bundle',
  ) {
    const data = (await this.postToClustering('/segment-for-products', {
      model_name: modelName ?? this.clusteringModelName(),
      products,
      auto_fit: true,
      ...(limit ? { limit } : {}),
      mode: mode ?? 'multi',
    })) as {
      best_segment: number;
      buyers: number;
      segment_total: number;
      total: number;
      recipients: SegRecipient[];
    };
    return {
      best_segment: data.best_segment,
      buyers: data.buyers,
      segment_total: data.segment_total,
      total: data.total,
      recipients: data.recipients ?? [],
    };
  }

  /**
   * POST genérico a un servicio de análisis (XGBoost / Uplift) sin admin key.
   * Levanta un error claro si el servicio no responde.
   */
  private async postToService(baseUrl: string, path: string, body: Record<string, unknown>) {
    const url = `${baseUrl}${path}`;
    let resp: Response;
    try {
      resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (e) {
      this.logger.error(`No se pudo contactar ${url}: ${e}`);
      throw new BadRequestException('Un servicio de análisis no está disponible');
    }
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      this.logger.error(`${url} respondió ${resp.status}: ${text}`);
      throw new BadRequestException('Un servicio de análisis no pudo completar la operación');
    }
    return resp.json();
  }

  /** Filas de features (RFM + segmento) que esperan los modelos de xgboost/uplift. */
  private buildModelRows(recipients: SegRecipient[]) {
    return recipients.map((r) => ({
      frecuencia: r.features?.frecuencia ?? 0,
      monetario: r.features?.monetario ?? 0,
      ticket_promedio: r.features?.ticket_promedio ?? 0,
      categorias_distintas: r.features?.categorias_distintas ?? 0,
      segmento: String(r.segment ?? 0),
    }));
  }

  /** Propensión de compra por cliente (XGBoost). Devuelve null si falla. */
  private async scorePropensity(recipients: SegRecipient[]): Promise<number[] | null> {
    try {
      const data = (await this.postToService(this.xgboostApiUrl(), '/propensity/predict', {
        model_name: this.xgboostModel(),
        data: this.buildModelRows(recipients),
      })) as {
        predictions?: { index: number; label: string; probabilities?: Record<string, number> }[];
      };
      return (data.predictions ?? []).map((p) => p.probabilities?.['1'] ?? 0);
    } catch (e) {
      this.logger.warn(`scorePropensity no disponible: ${e}`);
      return null;
    }
  }

  /** Persuasibilidad (uplift) por cliente. Devuelve null si falla. */
  private async scoreUplift(
    recipients: SegRecipient[],
  ): Promise<{ uplift: number; percentile: number }[] | null> {
    try {
      const data = (await this.postToService(this.upliftApiUrl(), '/uplift/predict', {
        model_name: this.upliftModel(),
        data: this.buildModelRows(recipients),
        with_percentile: true,
      })) as {
        predictions?: { index: number; uplift_score: number; percentile?: number }[];
      };
      return (data.predictions ?? []).map((p) => ({
        uplift: p.uplift_score,
        percentile: p.percentile ?? 0,
      }));
    } catch (e) {
      this.logger.warn(`scoreUplift no disponible: ${e}`);
      return null;
    }
  }

  /** external_id (articulo_cod del legado) de unos productIds dados. */
  private async externalIdsForProducts(productIds: number[]): Promise<string[]> {
    if (!productIds.length) return [];
    const rows = await this.db
      .select({ externalId: products.externalId })
      .from(products)
      .where(inArray(products.id, productIds.map((p) => BigInt(p))));
    return rows
      .map((r) => r.externalId)
      .filter((x): x is string => Boolean(x));
  }

  /** external_id (articulo_cod del legado) de los productos de la campaña. */
  private async campaignProductExternalIds(campaignId: number): Promise<string[]> {
    const rows = await this.db
      .select({ productId: campaignProducts.productId })
      .from(campaignProducts)
      .where(eq(campaignProducts.campaignId, campaignId));
    return this.externalIdsForProducts(rows.map((r) => r.productId));
  }

  /**
   * Previsualización de la segmentación para el wizard (SSE con progreso).
   * Hace proxy del stream de clustering-api y re-emite cada evento de etapa
   * y el resultado final al cliente.
   */
  segmentPreviewStream(
    productIds: number[],
    limit = 500,
    mode: 'multi' | 'bundle' = 'multi',
  ): Observable<MessageEvent> {
    const cap = Math.min(Math.max(limit, 1), 5000);
    return new Observable<MessageEvent>((subscriber) => {
      let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
      let closed = false;

      void (async () => {
        try {
          const extIds = await this.externalIdsForProducts(productIds);
          if (!extIds.length) {
            subscriber.next({
              data: {
                stage: 'error',
                error: 'Los productos seleccionados no tienen external_id en la réplica',
              },
            });
            subscriber.complete();
            return;
          }

          const resp = await fetch(`${this.clusteringApiUrl()}/segment-for-products`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Admin-Key': this.clusteringApiKey(),
            },
            body: JSON.stringify({
              model_name: this.clusteringModelName(),
              products: extIds,
              auto_fit: true,
              limit: cap,
              stream: true,
              mode,
            }),
          });
          if (!resp.ok || !resp.body) {
            subscriber.next({
              data: { stage: 'error', error: `El servicio de segmentación respondió ${resp.status}` },
            });
            subscriber.complete();
            return;
          }

          reader = resp.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';
          while (!closed) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const events = buffer.split('\n\n');
            buffer = events.pop() ?? '';
            for (const evt of events) {
              const line = evt.split('\n').find((l) => l.startsWith('data:'));
              if (!line) continue;
              const raw = line.slice(5).trim();
              if (!raw) continue;
              try {
                const parsed = JSON.parse(raw);
                if (parsed?.stage === 'done' && parsed?.result) {
                  const r = parsed.result;
                  const recipients: SegRecipient[] = r.recipients ?? [];

                  // Capa 2 — XGBoost: propensión de compra.
                  subscriber.next({
                    data: { stage: 'xgboost', message: 'Puntuando propensión de compra (XGBoost)…', progress: 88 },
                  });
                  const propensity = await this.scorePropensity(recipients);

                  // Capa 3 — Uplift: persuasibilidad.
                  subscriber.next({
                    data: { stage: 'uplift', message: 'Calculando persuasibilidad (Uplift)…', progress: 94 },
                  });
                  const uplift = await this.scoreUplift(recipients);

                  const enriched = recipients.map((rc, i) => ({
                    cedula: rc.cedula,
                    name: rc.name,
                    email: rc.email,
                    phone: rc.phone,
                    segment: rc.segment,
                    propensity: propensity ? (propensity[i] ?? null) : null,
                    uplift: uplift ? (uplift[i]?.uplift ?? null) : null,
                    percentile: uplift ? (uplift[i]?.percentile ?? null) : null,
                  }));

                  // Ranking: persuasibles primero (uplift), luego propensión.
                  enriched.sort((a, b) => {
                    const du = (b.uplift ?? -Infinity) - (a.uplift ?? -Infinity);
                    if (du !== 0) return du;
                    return (b.propensity ?? -Infinity) - (a.propensity ?? -Infinity);
                  });

                  subscriber.next({
                    data: {
                      stage: 'done',
                      progress: 100,
                      result: {
                        segment: r.best_segment,
                        segmentTotal: r.segment_total,
                        total: r.total,
                        buyers: r.buyers,
                        mode: r.mode ?? 'multi',
                        bundleFallback: r.bundle_fallback ?? false,
                        note: r.affinity_note,
                        recipients: enriched,
                      },
                    },
                  });
                } else {
                  subscriber.next({ data: parsed });
                }
              } catch {
                /* tramas malformadas: se ignoran */
              }
            }
          }
        } catch (e) {
          this.logger.error(`segment-preview stream error: ${e}`);
          subscriber.next({
            data: { stage: 'error', error: 'No se pudo completar la segmentación' },
          });
        } finally {
          if (!closed) subscriber.complete();
        }
      })();

      return () => {
        closed = true;
        reader?.cancel().catch(() => undefined);
      };
    });
  }

  async generateRecipients(
    id: number,
    limit = 500,
    segment?: number,
    modelName?: string,
    mode?: 'multi' | 'bundle',
  ) {
    await this.findOne(id);
    const cap = Math.min(Math.max(limit, 1), 5000);

    let items: {
      name: string | null;
      email: string | null;
      phone: string | null;
      customerId: number | null;
    }[];
    let note: string;
    let segInfo: { segment: number; buyers: number } | null = null;

    if (segment === undefined) {
      // ── Modo automático: segmenta según los productos de la campaña ──
      const extIds = await this.campaignProductExternalIds(id);
      if (extIds.length) {
        // La réplica de analytics (pos.clientes) es la fuente de destinatarios:
        // clustering-api devuelve el mejor segmento + el contacto de cada cliente.
        const seg = await this.segmentForProducts(modelName, extIds, cap, mode);
        if (!seg.recipients.length) {
          throw new BadRequestException(
            'El mejor segmento para estos productos no tiene clientes',
          );
        }
        items = [...seg.recipients]
          .sort(() => Math.random() - 0.5)
          .slice(0, cap)
          .map((r) => ({
            name: r.name,
            email: r.email,
            phone: r.phone,
            customerId: null,
          }));
        segInfo = { segment: seg.best_segment, buyers: seg.buyers };
        note = `Segmentación automática: segmento ${seg.best_segment} (${seg.total} clientes, ${seg.buyers} con afinidad a los productos; ${items.length} destinatarios)`;
      } else {
        // La campaña no tiene productos con external_id → aleatorio desde customers.
        const pool = await this.db
          .select({
            id: customers.id,
            name: sql<string>`concat_ws(' ', ${customers.firstName}, ${customers.lastName})`,
            email: customers.email,
            phone: customers.phone,
          })
          .from(customers)
          .where(
            and(
              eq(customers.isActive, true),
              isNull(customers.deletedAt),
              sql`${customers.email} IS NOT NULL AND ${customers.email} <> ''`,
            ),
          )
          .orderBy(sql`random()`)
          .limit(cap);
        if (!pool.length) {
          throw new BadRequestException(
            'No hay clientes disponibles para recomendar',
          );
        }
        items = pool.map((c) => ({
          name: c.name || null,
          email: c.email,
          phone: c.phone || null,
          customerId: Number(c.id),
        }));
        note = 'Recomendación aleatoria (la campaña no tiene productos con external_id)';
      }
    } else {
      // ── Modo manual: segmento específico (contactos del ecommerce) ──
      const cedulas = await this.fetchSegmentCedulas(segment, modelName);
      if (!cedulas.length) {
        throw new BadRequestException(
          `El segmento ${segment} no tiene clientes asignados`,
        );
      }
      const pool = await this.db
        .select({
          id: customers.id,
          name: sql<string>`concat_ws(' ', ${customers.firstName}, ${customers.lastName})`,
          email: customers.email,
          phone: customers.phone,
        })
        .from(customers)
        .where(
          and(
            eq(customers.isActive, true),
            isNull(customers.deletedAt),
            sql`${customers.email} IS NOT NULL AND ${customers.email} <> ''`,
            inArray(customers.documentNumber, cedulas),
          ),
        )
        .orderBy(sql`random()`)
        .limit(cap);
      if (!pool.length) {
        throw new BadRequestException(
          'No hay clientes disponibles para recomendar',
        );
      }
      items = pool.map((c) => ({
        name: c.name || null,
        email: c.email,
        phone: c.phone || null,
        customerId: Number(c.id),
      }));
      segInfo = { segment, buyers: cedulas.length };
      note = `Segmentación inteligente: cluster ${segment} (${cedulas.length} clientes en el segmento, ${pool.length} con contacto)`;
    }

    if (!items.length) {
      throw new BadRequestException(
        'No hay clientes disponibles para recomendar',
      );
    }

    await this.db
      .delete(campaignRecipients)
      .where(eq(campaignRecipients.campaignId, id));

    await this.db.insert(campaignRecipients).values(
      items.map((r) => ({
        campaignId: id,
        customerId: r.customerId,
        name: r.name,
        email: r.email,
        phone: r.phone,
      })),
    );

    await this.db
      .update(campaigns)
      .set({ audienceCount: items.length, updatedAt: new Date().toISOString() })
      .where(eq(campaigns.id, BigInt(id)));

    this.logger.log(`Campaña ${id}: ${items.length} destinatarios recomendados`);

    return {
      campaignId: id,
      total: items.length,
      segment: segInfo?.segment ?? null,
      note,
      recipients: items.map((r) => ({
        id: r.customerId ?? null,
        name: r.name,
        email: r.email,
        phone: r.phone,
      })),
    };
  }

  /* ── Generación de contenido con IA (/ia-service) ──────── */

  async generateContent(dto: {
    productId?: number;
    productName?: string;
    price?: number;
    discount?: number;
    prompt?: string;
    tone?: string;
    channels: Channel[];
    products?: { id?: number; name?: string; price?: number }[];
  }) {
    // El wizard permite seleccionar varios productos; si no viene la lista,
    // se arma con el producto principal.
    let items: { id?: number; name?: string; price?: number }[] =
      dto.products?.length ? [...dto.products] : [];
    if (!items.length && dto.productId) {
      items = [{ id: dto.productId, name: dto.productName, price: dto.price }];
    }

    // Completa nombre/precio desde la BD para los ids sin datos.
    const pending = items.filter(
      (p) => p.id != null && (!p.name || p.price === undefined),
    );
    if (pending.length) {
      const rows = await this.db
        .select({
          id: products.id,
          name: products.name,
          price: sql<number>`(SELECT pv.current_price::float8 FROM product_variants pv WHERE pv.product_id = ${products.id} AND pv.is_active = true AND pv.deleted_at IS NULL LIMIT 1)`,
        })
        .from(products)
        .where(
          sql`${products.id} = ANY(${sql`ARRAY[${sql.join(
            pending.map((p) => BigInt(p.id as number)),
            sql`, `,
          )}]::bigint[]`})`,
        );
      const byId = new Map(rows.map((r) => [Number(r.id), r]));
      items = items.map((p) => {
        if (p.id == null || (p.name && p.price !== undefined)) return p;
        const r = byId.get(Number(p.id));
        return {
          ...p,
          name: p.name ?? r?.name,
          price: p.price ?? r?.price,
        };
      });
    }

    const primary = items[0] ?? {};
    const body = {
      producto: {
        nombre: primary.name ?? dto.productName ?? 'producto',
        precio: primary.price ?? dto.price ?? null,
        descuento: dto.discount ?? null,
      },
      productos: items.map((p) => ({
        nombre: p.name ?? 'producto',
        precio: p.price ?? null,
        descuento: dto.discount ?? null,
      })),
      prompt: dto.prompt ?? '',
      tono: dto.tone ?? 'cercano',
      canales: dto.channels,
    };

    const url = `${this.iaServiceUrl()}/generate`;
    let resp: Response;
    try {
      resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (e) {
      this.logger.error(`No se pudo contactar ia-service en ${url}: ${e}`);
      throw new BadRequestException(
        'El servicio de IA de campañas (/ia-service) no está disponible',
      );
    }
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      this.logger.error(`ia-service respondió ${resp.status}: ${text}`);
      throw new BadRequestException(
        'El servicio de IA no pudo generar el contenido',
      );
    }
    return resp.json();
  }

  /* ── Helpers ────────────────────────────────────────── */

  private async loadProducts(ids: (number | null)[]) {
    const valid = [...new Set(ids.filter((x): x is number => x !== null))];
    const map = new Map<number, { id: number; name: string }>();
    if (!valid.length) return map;
    const rows = await this.db
      .select({ id: products.id, name: products.name })
      .from(products)
      .where(
        sql`${products.id} = ANY(${sql`ARRAY[${sql.join(
          valid.map((v) => BigInt(v)),
          sql`, `,
        )}]::bigint[]`})`,
      );
    for (const r of rows) map.set(Number(r.id), { id: Number(r.id), name: r.name });
    return map;
  }
}
