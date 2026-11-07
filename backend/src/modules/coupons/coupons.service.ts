import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { and, count, desc, eq, ilike, lte, or } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DrizzleService } from '../../database/drizzle.service';
import * as schema from '../../../drizzle/schema';
import {
  couponTransactions,
  coupons,
  orders,
  promotions,
} from '../../../drizzle/schema';
import {
  CouponDiscountType,
  CouponKind,
  IssueCouponDto,
  QueryCouponsDto,
  UpdateCouponDto,
} from './dto/coupon.dto';
import { generateCouponCodeString } from './coupon-code.util';

type Tx = NodePgDatabase<typeof schema>;

type CouponForOrder = {
  couponId: number;
  discountAmount: number;
  balance: number;
  kind: CouponKind;
};

function money(value: number): number {
  return Math.round(value * 100) / 100;
}

@Injectable()
export class CouponsService {
  private readonly logger = new Logger(CouponsService.name);

  constructor(private readonly drizzle: DrizzleService) {}

  private get db() {
    return this.drizzle.db;
  }

  private normalizeCode(code: string): string {
    return code.trim().toUpperCase();
  }

  private deriveKind(dto: {
    discountValue?: number;
    initialBalance?: number;
  }): CouponKind {
    const hasDiscount = (dto.discountValue ?? 0) > 0;
    const hasBalance = (dto.initialBalance ?? 0) > 0;
    if (hasDiscount && hasBalance) return CouponKind.MIXED;
    if (hasBalance) return CouponKind.BALANCE;
    return CouponKind.DISCOUNT;
  }

  async generateUniqueCode(prefix = 'CUP'): Promise<string> {
    for (let attempt = 0; attempt < 12; attempt++) {
      const code = generateCouponCodeString(prefix);
      const [existing] = await this.db
        .select({ id: coupons.id })
        .from(coupons)
        .where(eq(coupons.code, code))
        .limit(1);
      if (!existing) return code;
    }
    throw new InternalServerErrorException(
      'No se pudo generar un código único, intenta de nuevo',
    );
  }

  async issue(dto: IssueCouponDto, createdBy: number | null = null) {
    const quantity = dto.quantity ?? 1;
    const hasDiscount = (dto.discountValue ?? 0) > 0;
    const hasBalance = (dto.initialBalance ?? 0) > 0;

    if (!hasDiscount && !hasBalance) {
      throw new BadRequestException(
        'El cupón debe tener un descuento o un saldo inicial',
      );
    }
    if (hasDiscount && !dto.discountType) {
      throw new BadRequestException(
        'El tipo de descuento es obligatorio cuando hay descuento',
      );
    }
    if (hasDiscount && dto.discountType === CouponDiscountType.PERCENTAGE) {
      if ((dto.discountValue ?? 0) > 100) {
        throw new BadRequestException('El porcentaje no puede superar 100');
      }
    }
    if (dto.code && quantity > 1) {
      throw new BadRequestException(
        'Un código manual solo se puede usar para emitir un cupón',
      );
    }
    if (dto.startsAt && dto.expiresAt) {
      if (new Date(dto.expiresAt) <= new Date(dto.startsAt)) {
        throw new BadRequestException(
          'El vencimiento debe ser posterior al inicio',
        );
      }
    }

    const kind = dto.kind ?? this.deriveKind(dto);
    if (kind === CouponKind.DISCOUNT && !hasDiscount) {
      throw new BadRequestException('Falta el descuento del cupón');
    }
    if (kind === CouponKind.BALANCE && !hasBalance) {
      throw new BadRequestException('Falta el saldo inicial del cupón');
    }
    if (kind === CouponKind.MIXED && (!hasDiscount || !hasBalance)) {
      throw new BadRequestException(
        'Un cupón mixto requiere descuento y saldo inicial',
      );
    }

    const nowIso = new Date().toISOString();
    const issued: Array<{
      id: number;
      code: string;
      kind: string;
      initialBalance: string | null;
      currentBalance: string | null;
      expiresAt: string | null;
    }> = [];

    for (let i = 0; i < quantity; i++) {
      const manualCode = dto.code ? this.normalizeCode(dto.code) : null;
      const code = manualCode ?? (await this.generateUniqueCode());

      try {
        const [row] = await this.db
          .insert(coupons)
          .values({
            promotionId: dto.promotionId ?? null,
            code,
            kind,
            discountType: hasDiscount ? dto.discountType : null,
            discountValue: hasDiscount ? String(dto.discountValue) : null,
            maximumDiscount:
              dto.maximumDiscount != null ? String(dto.maximumDiscount) : null,
            initialBalance: hasBalance ? String(dto.initialBalance) : null,
            currentBalance: hasBalance ? String(dto.initialBalance) : null,
            currency: 'COP',
            status: 'active',
            maxUsesTotal: dto.maxUsesTotal ?? null,
            startsAt: dto.startsAt ?? nowIso,
            expiresAt: dto.expiresAt ?? null,
            maxUsesPerCustomer: dto.maxUsesPerCustomer ?? null,
            isActive: true,
            issuedCustomerId: dto.issuedCustomerId ?? null,
            createdBy,
            notes: dto.notes ?? null,
          })
          .returning({
            id: coupons.id,
            code: coupons.code,
            kind: coupons.kind,
            initialBalance: coupons.initialBalance,
            currentBalance: coupons.currentBalance,
            expiresAt: coupons.expiresAt,
          });

        await this.db.insert(couponTransactions).values({
          couponId: Number(row.id),
          type: 'ISSUE',
          discountAmount: '0',
          amount: hasBalance ? String(dto.initialBalance) : '0',
          balanceBefore: hasBalance ? '0' : null,
          balanceAfter: hasBalance ? String(dto.initialBalance) : null,
          createdBy,
          note: 'Emisión de cupón',
        });

        issued.push({
          id: Number(row.id),
          code: row.code,
          kind: row.kind,
          initialBalance: row.initialBalance,
          currentBalance: row.currentBalance,
          expiresAt: row.expiresAt,
        });
      } catch (error: any) {
        // Colisión de código autogenerado: reintentar una vez.
        if (!manualCode && String(error?.code) === '23505' && i < quantity) {
          i--;
          continue;
        }
        if (String(error?.code) === '23505') {
          throw new BadRequestException('El código de cupón ya existe');
        }
        throw error;
      }
    }

    this.logger.log(
      `Emitidos ${issued.length} cupón(es) tipo ${kind} por usuario ${createdBy ?? 'sistema'}`,
    );

    return { coupons: issued, quantity: issued.length };
  }

  async findAll(query: QueryCouponsDto) {
    const conditions: SQL[] = [];
    if (query.status && query.status !== 'all') {
      conditions.push(eq(coupons.status, query.status));
    }
    if (query.kind) {
      conditions.push(eq(coupons.kind, query.kind));
    }
    if (query.search) {
      const term = `%${query.search.trim()}%`;
      const searchCondition = or(
        ilike(coupons.code, term),
        ilike(coupons.notes, term),
      );
      if (searchCondition) conditions.push(searchCondition);
    }

    const limit = Math.min(
      Math.max(query.limit ? parseInt(query.limit, 10) : 50, 1),
      200,
    );
    const offset = Math.max(query.offset ? parseInt(query.offset, 10) : 0, 0);
    const where = conditions.length ? and(...conditions) : undefined;

    const rows = await this.db
      .select({
        id: coupons.id,
        code: coupons.code,
        kind: coupons.kind,
        promotionId: coupons.promotionId,
        discountType: coupons.discountType,
        discountValue: coupons.discountValue,
        maximumDiscount: coupons.maximumDiscount,
        initialBalance: coupons.initialBalance,
        currentBalance: coupons.currentBalance,
        currency: coupons.currency,
        status: coupons.status,
        maxUsesTotal: coupons.maxUsesTotal,
        maxUsesPerCustomer: coupons.maxUsesPerCustomer,
        timesUsed: coupons.timesUsed,
        startsAt: coupons.startsAt,
        expiresAt: coupons.expiresAt,
        isActive: coupons.isActive,
        issuedCustomerId: coupons.issuedCustomerId,
        notes: coupons.notes,
        createdAt: coupons.createdAt,
      })
      .from(coupons)
      .where(where)
      .orderBy(desc(coupons.createdAt))
      .limit(limit)
      .offset(offset);

    const [totalRow] = await this.db
      .select({ total: count(coupons.id) })
      .from(coupons)
      .where(where);

    return {
      items: rows.map((row) => ({
        ...row,
        id: Number(row.id),
        promotionId: row.promotionId ? Number(row.promotionId) : null,
        issuedCustomerId: row.issuedCustomerId
          ? Number(row.issuedCustomerId)
          : null,
      })),
      total: Number(totalRow?.total ?? 0),
    };
  }

  async findOne(id: number) {
    const [row] = await this.db
      .select()
      .from(coupons)
      .where(eq(coupons.id, BigInt(id)))
      .limit(1);

    if (!row) {
      throw new NotFoundException(`Cupón ${id} no encontrado`);
    }

    const transactions = await this.getTransactions(id);

    return {
      ...row,
      id: Number(row.id),
      promotionId: row.promotionId ? Number(row.promotionId) : null,
      issuedCustomerId: row.issuedCustomerId
        ? Number(row.issuedCustomerId)
        : null,
      transactions,
    };
  }

  async getTransactions(id: number) {
    const rows = await this.db
      .select({
        id: couponTransactions.id,
        couponId: couponTransactions.couponId,
        orderId: couponTransactions.orderId,
        customerId: couponTransactions.customerId,
        type: couponTransactions.type,
        discountAmount: couponTransactions.discountAmount,
        amount: couponTransactions.amount,
        balanceBefore: couponTransactions.balanceBefore,
        balanceAfter: couponTransactions.balanceAfter,
        note: couponTransactions.note,
        createdAt: couponTransactions.createdAt,
        orderReference: orders.referenceCode,
      })
      .from(couponTransactions)
      .leftJoin(orders, eq(orders.id, couponTransactions.orderId))
      .where(eq(couponTransactions.couponId, id))
      .orderBy(desc(couponTransactions.createdAt));

    return rows.map((row) => ({
      ...row,
      id: Number(row.id),
      couponId: Number(row.couponId),
      orderId: row.orderId ? Number(row.orderId) : null,
      customerId: row.customerId ? Number(row.customerId) : null,
    }));
  }

  async update(id: number, dto: UpdateCouponDto) {
    const existing = await this.findOne(id);
    const updateData: Record<string, unknown> = {
      updatedAt: new Date().toISOString(),
    };

    if (dto.isActive !== undefined) updateData.isActive = dto.isActive;
    if (dto.notes !== undefined) updateData.notes = dto.notes;
    if (dto.expiresAt !== undefined) updateData.expiresAt = dto.expiresAt;
    if (dto.maxUsesTotal !== undefined)
      updateData.maxUsesTotal = dto.maxUsesTotal;
    if (dto.maxUsesPerCustomer !== undefined) {
      updateData.maxUsesPerCustomer = dto.maxUsesPerCustomer;
    }
    if (dto.issuedCustomerId !== undefined) {
      updateData.issuedCustomerId = dto.issuedCustomerId;
    }

    if (dto.status !== undefined) {
      const allowed = ['active', 'blocked', 'expired', 'exhausted'];
      if (!allowed.includes(dto.status)) {
        throw new BadRequestException('Estado de cupón inválido');
      }
      updateData.status = dto.status;
      if (dto.status === 'blocked') updateData.isActive = false;
      if (dto.status === 'active') updateData.isActive = true;
    } else if (dto.isActive !== undefined) {
      if (dto.isActive) {
        if (existing.status === 'blocked') updateData.status = 'active';
        if (existing.status === 'expired') {
          throw new BadRequestException(
            'Un cupón vencido no se puede reactivar; extiende su vencimiento',
          );
        }
      } else {
        updateData.status = 'blocked';
      }
    }

    await this.db
      .update(coupons)
      .set(updateData)
      .where(eq(coupons.id, BigInt(id)));

    return this.findOne(id);
  }

  /**
   * Valida un código y calcula el descuento/ saldo disponible.
   * Lanza BadRequest cuando no es canjeable.
   */
  async previewForOrder(
    code: string,
    subtotal: number,
    customerId: number | null = null,
  ): Promise<CouponForOrder> {
    const normalized = this.normalizeCode(code);
    if (!normalized) {
      throw new BadRequestException('Ingresa el código del cupón');
    }

    const [row] = await this.db
      .select({
        id: coupons.id,
        code: coupons.code,
        kind: coupons.kind,
        status: coupons.status,
        isActive: coupons.isActive,
        discountType: coupons.discountType,
        discountValue: coupons.discountValue,
        maximumDiscount: coupons.maximumDiscount,
        currentBalance: coupons.currentBalance,
        maxUsesTotal: coupons.maxUsesTotal,
        maxUsesPerCustomer: coupons.maxUsesPerCustomer,
        timesUsed: coupons.timesUsed,
        startsAt: coupons.startsAt,
        expiresAt: coupons.expiresAt,
        issuedCustomerId: coupons.issuedCustomerId,
        promotionDiscountType: promotions.discountType,
        promotionDiscountValue: promotions.discountValue,
        promotionMaximumDiscount: promotions.maximumDiscount,
        promotionIsActive: promotions.isActive,
        promotionDeletedAt: promotions.deletedAt,
      })
      .from(coupons)
      .leftJoin(promotions, eq(promotions.id, coupons.promotionId))
      .where(eq(coupons.code, normalized))
      .limit(1);

    if (!row) {
      throw new BadRequestException('El cupón no existe');
    }
    if (!row.isActive || row.status === 'blocked') {
      throw new BadRequestException('El cupón está bloqueado');
    }
    if (row.status === 'expired') {
      throw new BadRequestException('El cupón está vencido');
    }
    if (row.status === 'exhausted') {
      throw new BadRequestException('El cupón ya fue consumido');
    }

    const now = new Date();
    if (row.startsAt && now < new Date(row.startsAt)) {
      throw new BadRequestException('El cupón aún no está vigente');
    }
    if (row.expiresAt && now > new Date(row.expiresAt)) {
      // Se marca vencido de forma perezosa.
      await this.db
        .update(coupons)
        .set({ status: 'expired', isActive: false })
        .where(eq(coupons.id, row.id));
      throw new BadRequestException('El cupón está vencido');
    }
    if (row.issuedCustomerId && Number(row.issuedCustomerId) !== customerId) {
      throw new BadRequestException('Este cupón está asignado a otro cliente');
    }

    if (row.promotionIsActive === false) {
      throw new BadRequestException('La promoción del cupón está inactiva');
    }

    if (row.maxUsesTotal != null && row.timesUsed >= row.maxUsesTotal) {
      throw new BadRequestException('El cupón alcanzó su límite de usos');
    }
    if (row.maxUsesPerCustomer != null && customerId != null) {
      const [used] = await this.db
        .select({ total: count(couponTransactions.id) })
        .from(couponTransactions)
        .where(
          and(
            eq(couponTransactions.couponId, Number(row.id)),
            eq(couponTransactions.customerId, customerId),
            eq(couponTransactions.type, 'REDEEM'),
          ),
        );
      if (Number(used?.total ?? 0) >= row.maxUsesPerCustomer) {
        throw new BadRequestException(
          'Ya usaste este cupón el máximo de veces permitido',
        );
      }
    }

    const kind = row.kind as CouponKind;

    // Descuento: propio del cupón o heredado de la promoción.
    let discountType = row.discountType;
    let discountValue =
      row.discountValue != null ? Number(row.discountValue) : null;
    let maximumDiscount =
      row.maximumDiscount != null ? Number(row.maximumDiscount) : null;

    if (discountValue == null && row.promotionDiscountValue != null) {
      discountType = row.promotionDiscountType;
      discountValue = Number(row.promotionDiscountValue);
      maximumDiscount =
        row.promotionMaximumDiscount != null
          ? Number(row.promotionMaximumDiscount)
          : maximumDiscount;
    }

    let discountAmount = 0;
    if (discountValue != null && discountValue > 0) {
      const isPercentage = discountType !== 'fixed';
      discountAmount = isPercentage
        ? (subtotal * discountValue) / 100
        : discountValue;
      if (maximumDiscount != null && maximumDiscount > 0) {
        discountAmount = Math.min(discountAmount, maximumDiscount);
      }
      discountAmount = Math.min(Math.max(discountAmount, 0), subtotal);
      discountAmount = money(discountAmount);
    }

    const balance =
      row.currentBalance != null ? Math.max(Number(row.currentBalance), 0) : 0;

    if (kind === CouponKind.DISCOUNT && discountAmount <= 0) {
      throw new BadRequestException(
        'El cupón no genera descuento para este pedido',
      );
    }
    if (kind === CouponKind.BALANCE && balance <= 0) {
      throw new BadRequestException('El cupón no tiene saldo disponible');
    }
    if (kind === CouponKind.MIXED && discountAmount <= 0 && balance <= 0) {
      throw new BadRequestException('El cupón no tiene descuento ni saldo');
    }

    return {
      couponId: Number(row.id),
      discountAmount,
      balance,
      kind,
    };
  }

  /** Valida sin lanzar excepción (endpoint público). */
  async validate(code: string, subtotal = 0) {
    try {
      const preview = await this.previewForOrder(code, subtotal, null);
      const detail = await this.db
        .select({
          kind: coupons.kind,
          status: coupons.status,
          expiresAt: coupons.expiresAt,
          currentBalance: coupons.currentBalance,
          discountType: coupons.discountType,
          discountValue: coupons.discountValue,
        })
        .from(coupons)
        .where(eq(coupons.id, BigInt(preview.couponId)))
        .limit(1);

      return {
        valid: true,
        kind: preview.kind,
        discountAmount: preview.discountAmount,
        balance: preview.balance,
        expiresAt: detail[0]?.expiresAt ?? null,
      };
    } catch (error) {
      return {
        valid: false,
        reason:
          error instanceof BadRequestException
            ? error.message
            : 'No se pudo validar el cupón',
        discountAmount: 0,
        balance: 0,
      };
    }
  }

  /**
   * Registra el consumo dentro de la transacción del pedido.
   * Decrementa el saldo de forma atómica y deja el movimiento en el ledger.
   */
  async commitRedemption(
    tx: Tx,
    params: {
      couponId: number;
      orderId: number;
      customerId: number | null;
      guestSessionId: number | null;
      discountAmount: number;
      balanceAmount: number;
      createdBy?: number | null;
    },
  ) {
    const {
      couponId,
      orderId,
      customerId,
      guestSessionId,
      discountAmount,
      balanceAmount,
    } = params;

    const [row] = await tx
      .select({
        id: coupons.id,
        currentBalance: coupons.currentBalance,
        timesUsed: coupons.timesUsed,
        status: coupons.status,
      })
      .from(coupons)
      .where(eq(coupons.id, BigInt(couponId)))
      .for('update')
      .limit(1);

    if (!row) {
      throw new BadRequestException('El cupón ya no existe');
    }

    const balanceBefore =
      row.currentBalance != null ? Number(row.currentBalance) : null;

    if (balanceAmount > 0) {
      if (balanceBefore == null || balanceBefore < balanceAmount) {
        throw new BadRequestException(
          'El saldo del cupón cambió, intenta de nuevo',
        );
      }
    }

    const balanceAfter =
      balanceBefore != null ? money(balanceBefore - balanceAmount) : null;

    await tx
      .update(coupons)
      .set({
        currentBalance: balanceAfter != null ? String(balanceAfter) : null,
        timesUsed: (row.timesUsed ?? 0) + 1,
        status:
          balanceAfter != null && balanceAfter <= 0
            ? 'exhausted'
            : row.status === 'exhausted'
              ? 'active'
              : row.status,
        isActive: balanceAfter != null && balanceAfter <= 0 ? false : true,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(coupons.id, BigInt(couponId)));

    await tx.insert(couponTransactions).values({
      couponId,
      orderId,
      customerId: customerId ?? null,
      guestSessionId: guestSessionId ?? null,
      type: 'REDEEM',
      discountAmount: String(money(discountAmount)),
      amount: String(money(balanceAmount)),
      balanceBefore: balanceBefore != null ? String(balanceBefore) : null,
      balanceAfter: balanceAfter != null ? String(balanceAfter) : null,
      createdBy: params.createdBy ?? null,
      note: 'Canje en pedido',
    });

    return {
      balanceBefore,
      balanceAfter,
    };
  }

  /** Devuelve saldo al cupón (cancelación / devolución). */
  async reverseForOrder(params: {
    couponId: number;
    orderId: number;
    customerId?: number | null;
    note?: string;
    createdBy?: number | null;
  }) {
    return this.drizzle.transaction(async (tx) => {
      const [row] = await tx
        .select({
          currentBalance: coupons.currentBalance,
          status: coupons.status,
          timesUsed: coupons.timesUsed,
          expiresAt: coupons.expiresAt,
        })
        .from(coupons)
        .where(eq(coupons.id, BigInt(params.couponId)))
        .for('update')
        .limit(1);

      if (!row) throw new NotFoundException('Cupón no encontrado');

      // Un pedido solo se revierte una vez (webhook y verificación pueden
      // coincidir en la misma cancelación).
      const [alreadyReversed] = await tx
        .select({ id: couponTransactions.id })
        .from(couponTransactions)
        .where(
          and(
            eq(couponTransactions.couponId, params.couponId),
            eq(couponTransactions.orderId, params.orderId),
            eq(couponTransactions.type, 'REVERSAL'),
          ),
        )
        .limit(1);

      if (alreadyReversed) {
        return { reversed: 0, alreadyReversed: true };
      }

      const [redeem] = await tx
        .select({ amount: couponTransactions.amount })
        .from(couponTransactions)
        .where(
          and(
            eq(couponTransactions.couponId, params.couponId),
            eq(couponTransactions.orderId, params.orderId),
            eq(couponTransactions.type, 'REDEEM'),
          ),
        )
        .limit(1);

      const amount = redeem ? Number(redeem.amount) : 0;
      if (amount <= 0) return { reversed: 0 };

      const balanceBefore =
        row.currentBalance != null ? Number(row.currentBalance) : 0;
      const balanceAfter = money(balanceBefore + amount);
      // Un cupón bloqueado sigue bloqueado; el resto vuelve a estar activo
      // aunque ya haya vencido (el saldo igual se puede reutilizar).
      const nextStatus = row.status === 'blocked' ? 'blocked' : 'active';

      await tx
        .update(coupons)
        .set({
          currentBalance: String(balanceAfter),
          status: nextStatus,
          isActive: nextStatus !== 'blocked',
          timesUsed: Math.max(0, (row.timesUsed ?? 1) - 1),
          updatedAt: new Date().toISOString(),
        })
        .where(eq(coupons.id, BigInt(params.couponId)));

      await tx.insert(couponTransactions).values({
        couponId: params.couponId,
        orderId: params.orderId,
        customerId: params.customerId ?? null,
        type: 'REVERSAL',
        discountAmount: '0',
        amount: String(amount),
        balanceBefore: String(balanceBefore),
        balanceAfter: String(balanceAfter),
        createdBy: params.createdBy ?? null,
        note: params.note ?? 'Reverso por cancelación',
      });

      return { reversed: amount, balanceAfter };
    });
  }

  /** Cupones vencidos aún activos (para job programado o consulta). */
  async findExpired() {
    const nowIso = new Date().toISOString();
    return this.db
      .select({ id: coupons.id, code: coupons.code })
      .from(coupons)
      .where(and(eq(coupons.status, 'active'), lte(coupons.expiresAt, nowIso)))
      .limit(200);
  }
}
