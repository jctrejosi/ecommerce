import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import { DrizzleService } from '../../database/drizzle.service';
import {
  campaignMessages,
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

@Injectable()
export class CampaignsService {
  private readonly logger = new Logger(CampaignsService.name);

  constructor(private readonly drizzle: DrizzleService) {}

  private get db() {
    return this.drizzle.db;
  }

  private adminIaUrl(): string {
    return process.env.ADMIN_IA_URL ?? 'http://127.0.0.1:8002';
  }

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

    return rows.map((c) => ({
      ...this.toCampaign(c),
      product:
        c.productId != null
          ? (productsById.get(Number(c.productId)) ?? null)
          : null,
      messages: messages
        .filter((m) => Number(m.campaignId) === Number(c.id))
        .map((m) => this.toMessage(m)),
    }));
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

    const recipientsCount = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(campaignRecipients)
      .where(eq(campaignRecipients.campaignId, id));

    return {
      ...this.toCampaign(row),
      product: product ? { id: Number(product.id), name: product.name } : null,
      messages: messages.map((m) => this.toMessage(m)),
      recipientsCount: recipientsCount[0]?.count ?? 0,
    };
  }

  async create(dto: CreateCampaignDto, userId?: number) {
    const [row] = await this.db
      .insert(campaigns)
      .values({
        name: dto.name,
        productId: dto.productId ?? null,
        prompt: dto.prompt ?? null,
        tone: dto.tone ?? null,
        channels: dto.channels ?? [],
        createdBy: userId ?? null,
      })
      .returning();

    await this.upsertMessages(Number(row.id), dto.messages ?? []);
    return this.findOne(Number(row.id));
  }

  async update(id: number, dto: UpdateCampaignDto) {
    const existing = await this.findOne(id);
    const [row] = await this.db
      .update(campaigns)
      .set({
        name: dto.name ?? existing.name,
        productId: dto.productId ?? existing.productId,
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

  /* ── Recomendación de clientes (ALEATORIA por ahora) ───
     TODO: reemplazar por segmentación inteligente. */

  async listRecipients(id: number) {
    await this.findOne(id);
    const rows = await this.db
      .select()
      .from(campaignRecipients)
      .where(eq(campaignRecipients.campaignId, id))
      .orderBy(asc(campaignRecipients.id));
    return rows.map((r) => this.toRecipient(r));
  }

  async generateRecipients(id: number, limit = 500) {
    await this.findOne(id);
    const cap = Math.min(Math.max(limit, 1), 5000);

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

    await this.db
      .delete(campaignRecipients)
      .where(eq(campaignRecipients.campaignId, id));

    await this.db.insert(campaignRecipients).values(
      pool.map((c) => ({
        campaignId: id,
        customerId: Number(c.id),
        name: c.name || null,
        email: c.email,
        phone: c.phone || null,
      })),
    );

    await this.db
      .update(campaigns)
      .set({ audienceCount: pool.length, updatedAt: new Date().toISOString() })
      .where(eq(campaigns.id, BigInt(id)));

    this.logger.log(
      `Campaña ${id}: recomendación aleatoria de ${pool.length} clientes`,
    );

    return {
      campaignId: id,
      total: pool.length,
      recipients: pool.map((c) => ({
        id: Number(c.id),
        name: c.name,
        email: c.email,
        phone: c.phone,
      })),
      note: 'Recomendación aleatoria (la segmentación inteligente se conectará después)',
    };
  }

  /* ── Generación de contenido con IA (/admin-ia) ──────── */

  async generateContent(dto: {
    productId?: number;
    productName?: string;
    price?: number;
    discount?: number;
    prompt?: string;
    tone?: string;
    channels: Channel[];
  }) {
    let productName = dto.productName;
    let price = dto.price;
    if (dto.productId && (!productName || price === undefined)) {
      const [p] = await this.db
        .select({
          name: products.name,
          price: sql<number>`(SELECT pv.current_price::float8 FROM product_variants pv WHERE pv.product_id = ${products.id} AND pv.is_active = true AND pv.deleted_at IS NULL LIMIT 1)`,
        })
        .from(products)
        .where(eq(products.id, BigInt(dto.productId)));
      if (p) {
        productName = productName ?? p.name;
        price = price ?? p.price ?? undefined;
      }
    }

    const body = {
      producto: {
        nombre: productName ?? 'producto',
        precio: price ?? null,
        descuento: dto.discount ?? null,
      },
      prompt: dto.prompt ?? '',
      tono: dto.tone ?? 'cercano',
      canales: dto.channels,
    };

    const url = `${this.adminIaUrl()}/generate`;
    let resp: Response;
    try {
      resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (e) {
      this.logger.error(`No se pudo contactar admin-ia en ${url}: ${e}`);
      throw new BadRequestException(
        'El servicio de IA de campañas (/admin-ia) no está disponible',
      );
    }
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      this.logger.error(`admin-ia respondió ${resp.status}: ${text}`);
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
