import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import {
  and,
  eq,
  ilike,
  gte,
  lt,
  desc,
  sql,
  count,
  or,
  isNull,
  inArray,
} from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DrizzleService } from '../../database/drizzle.service';
import * as schema from '../../../drizzle/schema';
import {
  promotions,
  coupons,
  couponRedemptions,
  orders,
  customers,
  promotionCategories,
  promotionBranches,
  promotionProducts,
  promotionCombos,
  promotionComboItems,
  productVariants,
  products,
} from '../../../drizzle/schema';
import {
  CreatePromotionDto,
  UpdatePromotionDto,
  QueryPromotionsDto,
  DiscountType,
  PromotionComboMode,
} from './dto/promotion.dto';
import { generateCouponCodeString } from '../coupons/coupon-code.util';

type Tx = NodePgDatabase<typeof schema>;

@Injectable()
export class PromotionsService {
  private readonly logger = new Logger(PromotionsService.name);

  constructor(private readonly drizzle: DrizzleService) {}

  private get db() {
    return this.drizzle.db;
  }

  private computeStatus(promo: {
    isActive: boolean;
    startDate: string;
    endDate: string;
  }): 'activo' | 'programado' | 'expirado' | 'inactivo' {
    if (!promo.isActive) return 'inactivo';
    const now = new Date();
    const start = new Date(promo.startDate);
    const end = new Date(promo.endDate);
    if (now < start) return 'programado';
    if (now > end) return 'expirado';
    return 'activo';
  }

  async findAll(query: QueryPromotionsDto) {
    const conditions: ReturnType<typeof and>[] = [isNull(promotions.deletedAt)];

    if (query.search) {
      const searchTerm = `%${query.search}%`;
      conditions.push(
        or(
          ilike(promotions.name, searchTerm),
          sql`EXISTS (
            SELECT 1 FROM ${coupons}
            WHERE ${coupons.promotionId} = ${promotions.id}
            AND ${ilike(coupons.code, searchTerm)}
          )`,
        ),
      );
    }

    const limit = query.limit ? parseInt(query.limit, 10) : 50;
    const offset = query.offset ? parseInt(query.offset, 10) : 0;

    const rows = await this.db
      .select({
        id: promotions.id,
        name: promotions.name,
        description: promotions.description,
        isAutoApply: promotions.isAutoApply,
        requiresCode: promotions.requiresCode,
        discountType: promotions.discountType,
        discountValue: promotions.discountValue,
        maximumDiscount: promotions.maximumDiscount,
        weekdays: promotions.weekdays,
        priority: promotions.priority,
        stackable: promotions.stackable,
        exclusive: promotions.exclusive,
        usageLimit: promotions.usageLimit,
        timesUsed: promotions.timesUsed,
        startDate: promotions.startDate,
        endDate: promotions.endDate,
        isActive: promotions.isActive,
        createdAt: promotions.createdAt,
        updatedAt: promotions.updatedAt,
        couponCode: coupons.code,
        couponMaxUsesTotal: coupons.maxUsesTotal,
        couponTimesUsed: coupons.timesUsed,
        couponMaxUsesPerCustomer: coupons.maxUsesPerCustomer,
      })
      .from(promotions)
      .leftJoin(coupons, eq(coupons.promotionId, promotions.id))
      .where(and(...conditions))
      .orderBy(desc(promotions.priority), desc(promotions.createdAt))
      .limit(limit)
      .offset(offset);

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const promotionIds = rows.map((row) => Number(row.id));
    const targets = await this.loadTargetSummaries(promotionIds);

    const result = await Promise.all(
      rows.map(async (row) => {
        const usagesToday = await this.getPromotionUsagesToday(Number(row.id));

        const status = this.computeStatus({
          isActive: row.isActive,
          startDate: row.startDate,
          endDate: row.endDate,
        });

        const targetsForPromo = targets.get(Number(row.id)) ?? {
          categoryIds: [] as number[],
          branchIds: [] as number[],
          productIds: [] as number[],
          comboCount: 0,
        };

        return {
          id: Number(row.id),
          name: row.name,
          description: row.description,
          discountType: this.apiDiscountType(
            row.discountType,
            !!row.couponCode,
          ),
          discountValue: row.discountValue,
          maximumDiscount: row.maximumDiscount,
          weekdays: row.weekdays ?? [],
          categoryIds: targetsForPromo.categoryIds,
          branchIds: targetsForPromo.branchIds,
          productIds: targetsForPromo.productIds,
          comboCount: targetsForPromo.comboCount,
          appliesTo:
            targetsForPromo.categoryIds.length ||
            targetsForPromo.productIds.length ||
            targetsForPromo.comboCount
              ? 'targeted'
              : 'all',
          couponCode: row.couponCode,
          couponMaxUsesTotal: row.couponMaxUsesTotal,
          couponTimesUsed: row.couponTimesUsed,
          couponMaxUsesPerCustomer: row.couponMaxUsesPerCustomer,
          isAutoApply: row.isAutoApply,
          requiresCode: row.requiresCode,
          priority: row.priority,
          stackable: row.stackable,
          exclusive: row.exclusive,
          usageLimit: row.usageLimit,
          timesUsed: row.timesUsed,
          startDate: row.startDate,
          endDate: row.endDate,
          isActive: row.isActive,
          status,
          usagesToday,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        };
      }),
    );

    if (query.status && query.status !== 'todas') {
      return result.filter((r) => r.status === query.status);
    }

    if (query.usagesToday === 'true') {
      return result.filter((r) => r.usagesToday > 0);
    }

    return result;
  }

  async getStats() {
    const allRows = await this.db
      .select({
        id: promotions.id,
        isActive: promotions.isActive,
        startDate: promotions.startDate,
        endDate: promotions.endDate,
      })
      .from(promotions)
      .where(isNull(promotions.deletedAt));

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    let activas = 0;
    let programadas = 0;
    let usosHoy = 0;

    for (const p of allRows) {
      const status = this.computeStatus({
        isActive: p.isActive,
        startDate: p.startDate,
        endDate: p.endDate,
      });
      if (status === 'activo') activas++;
      if (status === 'programado') programadas++;

      const todayCount = await this.getPromotionUsagesToday(Number(p.id));
      usosHoy += todayCount;
    }

    // Descuento otorgado hoy (promociones automáticas y cupones quedan
    // reflejados en orders.discount_total al crear el pedido).
    const discountResult = await this.db
      .select({
        total: sql<string>`COALESCE(SUM(${orders.discountTotal}), 0)`,
      })
      .from(orders)
      .where(
        and(
          gte(orders.createdAt, today.toISOString()),
          lt(orders.createdAt, tomorrow.toISOString()),
        ),
      );

    const descuentoAplicado = discountResult[0]?.total
      ? Number(discountResult[0].total)
      : 0;

    return { activas, programadas, usosHoy, descuentoAplicado };
  }

  async findOne(id: number) {
    const row = await this.db
      .select({
        id: promotions.id,
        name: promotions.name,
        description: promotions.description,
        isAutoApply: promotions.isAutoApply,
        requiresCode: promotions.requiresCode,
        discountType: promotions.discountType,
        discountValue: promotions.discountValue,
        maximumDiscount: promotions.maximumDiscount,
        weekdays: promotions.weekdays,
        priority: promotions.priority,
        stackable: promotions.stackable,
        exclusive: promotions.exclusive,
        usageLimit: promotions.usageLimit,
        timesUsed: promotions.timesUsed,
        startDate: promotions.startDate,
        endDate: promotions.endDate,
        isActive: promotions.isActive,
        createdAt: promotions.createdAt,
        updatedAt: promotions.updatedAt,
        couponId: coupons.id,
        couponCode: coupons.code,
        couponMaxUsesTotal: coupons.maxUsesTotal,
        couponTimesUsed: coupons.timesUsed,
        couponMaxUsesPerCustomer: coupons.maxUsesPerCustomer,
        couponStartsAt: coupons.startsAt,
        couponExpiresAt: coupons.expiresAt,
        couponIsActive: coupons.isActive,
      })
      .from(promotions)
      .leftJoin(coupons, eq(coupons.promotionId, promotions.id))
      .where(and(eq(promotions.id, BigInt(id)), isNull(promotions.deletedAt)))
      .limit(1);

    if (!row.length) {
      throw new NotFoundException(`Promoción con ID ${id} no encontrada`);
    }

    const promo = row[0];
    const status = this.computeStatus({
      isActive: promo.isActive,
      startDate: promo.startDate,
      endDate: promo.endDate,
    });

    const usagesToday = await this.getPromotionUsagesToday(id);
    const targets = await this.loadTargetDetails(id);

    return {
      id: Number(promo.id),
      name: promo.name,
      description: promo.description,
      discountType: this.apiDiscountType(
        promo.discountType,
        !!promo.couponCode,
      ),
      discountValue: promo.discountValue,
      maximumDiscount: promo.maximumDiscount,
      weekdays: promo.weekdays ?? [],
      categoryIds: targets.categoryIds,
      branchIds: targets.branchIds,
      products: targets.products,
      combos: targets.combos,
      appliesTo: targets.appliesTo,
      couponId: promo.couponId ? Number(promo.couponId) : null,
      couponCode: promo.couponCode,
      couponMaxUsesTotal: promo.couponMaxUsesTotal,
      couponTimesUsed: promo.couponTimesUsed,
      couponMaxUsesPerCustomer: promo.couponMaxUsesPerCustomer,
      couponStartsAt: promo.couponStartsAt,
      couponExpiresAt: promo.couponExpiresAt,
      couponIsActive: promo.couponIsActive,
      isAutoApply: promo.isAutoApply,
      requiresCode: promo.requiresCode,
      priority: promo.priority,
      stackable: promo.stackable,
      exclusive: promo.exclusive,
      usageLimit: promo.usageLimit,
      timesUsed: promo.timesUsed,
      startDate: promo.startDate,
      endDate: promo.endDate,
      isActive: promo.isActive,
      status,
      usagesToday,
      createdAt: promo.createdAt,
      updatedAt: promo.updatedAt,
    };
  }

  async getPromotionUsages(id: number, dateFilter?: 'today' | 'all') {
    const redemptions = await this.db
      .select({
        redemptionId: couponRedemptions.id,
        discountAmount: couponRedemptions.discountAmount,
        usedAt: couponRedemptions.usedAt,
        orderId: couponRedemptions.orderId,
        customerId: couponRedemptions.customerId,
        couponCode: coupons.code,
      })
      .from(couponRedemptions)
      .innerJoin(coupons, eq(coupons.id, couponRedemptions.couponId))
      .where(eq(coupons.promotionId, id))
      .orderBy(desc(couponRedemptions.usedAt));

    let filtered = redemptions;
    if (dateFilter === 'today') {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      filtered = redemptions.filter((r) => {
        const used = new Date(r.usedAt);
        return used >= today && used < tomorrow;
      });
    }

    const result = await Promise.all(
      filtered.map(async (r) => {
        let orderInfo: {
          id: number;
          orderNumber: string;
          total: string;
          status: string;
          createdAt: string;
        } | null = null;
        let customerInfo: {
          id: number;
          name: string;
          email: string;
        } | null = null;

        if (r.orderId) {
          const orderRows = await this.db
            .select({
              id: orders.id,
              referenceCode: orders.referenceCode,
              grandTotal: orders.grandTotal,
              status: orders.status,
              createdAt: orders.createdAt,
            })
            .from(orders)
            .where(eq(orders.id, BigInt(r.orderId)))
            .limit(1);
          if (orderRows.length) {
            orderInfo = {
              id: Number(orderRows[0].id),
              orderNumber: orderRows[0].referenceCode,
              total: orderRows[0].grandTotal,
              status: orderRows[0].status,
              createdAt: orderRows[0].createdAt,
            };
          }
        }

        if (r.customerId) {
          const customerRows = await this.db
            .select({
              id: customers.id,
              firstName: customers.firstName,
              lastName: customers.lastName,
              email: customers.email,
            })
            .from(customers)
            .where(eq(customers.id, BigInt(r.customerId)))
            .limit(1);
          if (customerRows.length) {
            customerInfo = {
              id: Number(customerRows[0].id),
              name: [customerRows[0].firstName, customerRows[0].lastName]
                .filter(Boolean)
                .join(' '),
              email: customerRows[0].email,
            };
          }
        }

        return {
          redemptionId: Number(r.redemptionId),
          discountAmount: r.discountAmount,
          usedAt: r.usedAt,
          couponCode: r.couponCode,
          order: orderInfo,
          customer: customerInfo,
        };
      }),
    );

    return result;
  }

  private async getPromotionUsagesToday(promotionId: number): Promise<number> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const result = await this.db
      .select({ cnt: count(couponRedemptions.id) })
      .from(couponRedemptions)
      .innerJoin(coupons, eq(coupons.id, couponRedemptions.couponId))
      .where(
        and(
          eq(coupons.promotionId, promotionId),
          gte(couponRedemptions.usedAt, today.toISOString()),
          lt(couponRedemptions.usedAt, tomorrow.toISOString()),
        ),
      );

    return result[0]?.cnt ?? 0;
  }

  // ── Helpers de metas (categorías / productos / combos) ──

  private apiDiscountType(dbType: string, isCoupon: boolean): DiscountType {
    if (isCoupon) return DiscountType.CUPON;
    return dbType === 'fixed' ? DiscountType.FIJO : DiscountType.PORCENTAJE;
  }

  private dbDiscountType(type: DiscountType): 'percentage' | 'fixed' {
    return type === DiscountType.FIJO ? 'fixed' : 'percentage';
  }

  private async resolveVariantIds(
    productIds: number[],
  ): Promise<Map<number, number>> {
    const unique = [...new Set(productIds.filter((id) => Number.isFinite(id)))];
    const map = new Map<number, number>();
    if (!unique.length) return map;

    const rows = await this.db
      .select({ id: productVariants.id, productId: productVariants.productId })
      .from(productVariants)
      .where(
        and(
          inArray(productVariants.productId, unique),
          isNull(productVariants.deletedAt),
        ),
      )
      .orderBy(productVariants.id);

    for (const row of rows) {
      const productId = Number(row.productId);
      if (!map.has(productId)) map.set(productId, Number(row.id));
    }
    return map;
  }

  private async loadTargetSummaries(promotionIds: number[]) {
    const map = new Map<
      number,
      {
        categoryIds: number[];
        branchIds: number[];
        productIds: number[];
        comboCount: number;
      }
    >();
    if (!promotionIds.length) return map;

    const [catRows, branchRows, prodRows, comboRows] = await Promise.all([
      this.db
        .select({
          promotionId: promotionCategories.promotionId,
          categoryId: promotionCategories.categoryId,
        })
        .from(promotionCategories)
        .where(inArray(promotionCategories.promotionId, promotionIds)),
      this.db
        .select({
          promotionId: promotionBranches.promotionId,
          branchId: promotionBranches.branchId,
        })
        .from(promotionBranches)
        .where(inArray(promotionBranches.promotionId, promotionIds)),
      this.db
        .select({
          promotionId: promotionProducts.promotionId,
          productId: productVariants.productId,
        })
        .from(promotionProducts)
        .innerJoin(
          productVariants,
          eq(productVariants.id, promotionProducts.productVariantId),
        )
        .where(inArray(promotionProducts.promotionId, promotionIds)),
      this.db
        .select({
          promotionId: promotionCombos.promotionId,
          id: promotionCombos.id,
        })
        .from(promotionCombos)
        .where(inArray(promotionCombos.promotionId, promotionIds)),
    ]);

    const ensure = (id: number) => {
      let entry = map.get(id);
      if (!entry) {
        entry = {
          categoryIds: [],
          branchIds: [],
          productIds: [],
          comboCount: 0,
        };
        map.set(id, entry);
      }
      return entry;
    };

    for (const row of catRows) {
      ensure(Number(row.promotionId)).categoryIds.push(Number(row.categoryId));
    }
    for (const row of branchRows) {
      ensure(Number(row.promotionId)).branchIds.push(Number(row.branchId));
    }
    for (const row of prodRows) {
      ensure(Number(row.promotionId)).productIds.push(Number(row.productId));
    }
    for (const row of comboRows) {
      ensure(Number(row.promotionId)).comboCount += 1;
    }

    return map;
  }

  private async loadTargetDetails(promotionId: number) {
    const [catRows, branchRows, prodRows, comboRows] = await Promise.all([
      this.db
        .select({ categoryId: promotionCategories.categoryId })
        .from(promotionCategories)
        .where(eq(promotionCategories.promotionId, promotionId)),
      this.db
        .select({ branchId: promotionBranches.branchId })
        .from(promotionBranches)
        .where(eq(promotionBranches.promotionId, promotionId)),
      this.db
        .select({
          productId: productVariants.productId,
          name: products.name,
          discountValue: promotionProducts.discountValue,
          isPercentage: promotionProducts.isPercentage,
          maximumDiscount: promotionProducts.maximumDiscount,
        })
        .from(promotionProducts)
        .innerJoin(
          productVariants,
          eq(productVariants.id, promotionProducts.productVariantId),
        )
        .innerJoin(products, eq(products.id, productVariants.productId))
        .where(eq(promotionProducts.promotionId, promotionId)),
      this.db
        .select({
          id: promotionCombos.id,
          name: promotionCombos.name,
          mode: promotionCombos.mode,
          quantityRequired: promotionCombos.quantityRequired,
          discountValue: promotionCombos.discountValue,
          isPercentage: promotionCombos.isPercentage,
        })
        .from(promotionCombos)
        .where(eq(promotionCombos.promotionId, promotionId))
        .orderBy(promotionCombos.id),
    ]);

    const comboIds = comboRows.map((c) => Number(c.id));
    const itemRows = comboIds.length
      ? await this.db
          .select({
            comboId: promotionComboItems.comboId,
            productId: productVariants.productId,
            name: products.name,
            discountValue: promotionComboItems.discountValue,
            isPercentage: promotionComboItems.isPercentage,
          })
          .from(promotionComboItems)
          .innerJoin(
            productVariants,
            eq(productVariants.id, promotionComboItems.productVariantId),
          )
          .innerJoin(products, eq(products.id, productVariants.productId))
          .where(inArray(promotionComboItems.comboId, comboIds))
      : [];

    const categoryIds = catRows.map((r) => Number(r.categoryId));
    const branchIds = branchRows.map((r) => Number(r.branchId));

    const combos = comboRows.map((combo) => ({
      id: Number(combo.id),
      name: combo.name,
      mode: combo.mode as PromotionComboMode,
      quantityRequired: combo.quantityRequired,
      discountValue: combo.discountValue,
      isPercentage: combo.isPercentage,
      items: itemRows
        .filter((item) => Number(item.comboId) === Number(combo.id))
        .map((item) => ({
          productId: Number(item.productId),
          name: item.name,
          discountValue: item.discountValue,
          isPercentage: item.isPercentage,
        })),
    }));

    const appliesTo =
      categoryIds.length || prodRows.length || combos.length
        ? 'targeted'
        : 'all';

    return {
      categoryIds,
      branchIds,
      products: prodRows.map((row) => ({
        productId: Number(row.productId),
        name: row.name,
        discountValue: row.discountValue,
        isPercentage: row.isPercentage,
        maximumDiscount: row.maximumDiscount,
      })),
      combos,
      appliesTo,
    };
  }

  private async replaceTargets(
    tx: Tx,
    promotionId: number,
    dto: Pick<
      UpdatePromotionDto,
      'categoryIds' | 'branchIds' | 'products' | 'combos'
    >,
  ) {
    if (dto.categoryIds !== undefined) {
      await tx
        .delete(promotionCategories)
        .where(eq(promotionCategories.promotionId, promotionId));
      const unique = [
        ...new Set(dto.categoryIds.filter((id) => Number.isFinite(id))),
      ];
      if (unique.length) {
        await tx
          .insert(promotionCategories)
          .values(unique.map((categoryId) => ({ promotionId, categoryId })));
      }
    }

    if (dto.branchIds !== undefined) {
      await tx
        .delete(promotionBranches)
        .where(eq(promotionBranches.promotionId, promotionId));
      const unique = [
        ...new Set(dto.branchIds.filter((id) => Number.isFinite(id))),
      ];
      if (unique.length) {
        await tx
          .insert(promotionBranches)
          .values(unique.map((branchId) => ({ promotionId, branchId })));
      }
    }

    if (dto.products !== undefined) {
      await tx
        .delete(promotionProducts)
        .where(eq(promotionProducts.promotionId, promotionId));
      const variantMap = await this.resolveVariantIds(
        dto.products.map((p) => p.productId),
      );
      const seen = new Set<number>();
      const values = dto.products
        .map((item) => {
          const variantId = variantMap.get(item.productId);
          if (!variantId || seen.has(variantId)) return null;
          seen.add(variantId);
          return {
            promotionId,
            productVariantId: variantId,
            discountValue:
              item.discountValue !== undefined
                ? String(item.discountValue)
                : null,
            isPercentage: item.isPercentage ?? true,
            maximumDiscount:
              item.maximumDiscount !== undefined
                ? String(item.maximumDiscount)
                : null,
          };
        })
        .filter((v): v is NonNullable<typeof v> => v !== null);
      if (values.length) {
        await tx.insert(promotionProducts).values(values);
      }
    }

    if (dto.combos !== undefined) {
      await tx
        .delete(promotionCombos)
        .where(eq(promotionCombos.promotionId, promotionId));

      for (const combo of dto.combos) {
        const variantMap = await this.resolveVariantIds(
          combo.items.map((item) => item.productId),
        );
        const seen = new Set<number>();
        const itemValues = combo.items
          .map((item) => {
            const variantId = variantMap.get(item.productId);
            if (!variantId || seen.has(variantId)) return null;
            seen.add(variantId);
            return {
              productVariantId: variantId,
              discountValue:
                combo.mode === PromotionComboMode.PER_PRODUCT
                  ? String(item.discountValue ?? 0)
                  : String(combo.discountValue ?? 0),
              isPercentage:
                combo.mode === PromotionComboMode.PER_PRODUCT
                  ? (item.isPercentage ?? true)
                  : (combo.isPercentage ?? true),
            };
          })
          .filter((v): v is NonNullable<typeof v> => v !== null);

        if (!itemValues.length) continue;

        const [created] = await tx
          .insert(promotionCombos)
          .values({
            promotionId,
            name: combo.name ?? null,
            mode: combo.mode,
            quantityRequired:
              combo.quantityRequired ?? Math.max(2, itemValues.length),
            discountValue: String(combo.discountValue ?? 0),
            isPercentage: combo.isPercentage ?? true,
          })
          .returning({ id: promotionCombos.id });

        await tx.insert(promotionComboItems).values(
          itemValues.map((item) => ({
            comboId: Number(created.id),
            ...item,
          })),
        );
      }
    }
  }

  private async generateUniqueCouponCode(): Promise<string> {
    for (let attempt = 0; attempt < 12; attempt++) {
      const code = generateCouponCodeString();
      const [existing] = await this.db
        .select({ id: coupons.id })
        .from(coupons)
        .where(eq(coupons.code, code))
        .limit(1);
      if (!existing) return code;
    }
    throw new BadRequestException(
      'No se pudo generar un código de cupón único, intenta de nuevo',
    );
  }

  async create(dto: CreatePromotionDto) {
    if (new Date(dto.endDate) <= new Date(dto.startDate)) {
      throw new BadRequestException(
        'La fecha de fin debe ser posterior a la fecha de inicio',
      );
    }

    if (dto.discountType === DiscountType.CUPON && !dto.couponCode) {
      dto.couponCode = await this.generateUniqueCouponCode();
    }

    if (dto.couponCode) {
      const existing = await this.db
        .select({ id: coupons.id })
        .from(coupons)
        .where(eq(coupons.code, dto.couponCode.toUpperCase()))
        .limit(1);
      if (existing.length) {
        throw new BadRequestException(
          `El código de cupón "${dto.couponCode}" ya existe`,
        );
      }
    }

    const requiresCode =
      (dto.discountType as string) === 'cupon' || !!dto.couponCode;

    const promoId = await this.drizzle.transaction(async (tx) => {
      const [newPromo] = await tx
        .insert(promotions)
        .values({
          name: dto.name,
          description: dto.description ?? null,
          isAutoApply: dto.isAutoApply ?? false,
          requiresCode,
          discountType: this.dbDiscountType(dto.discountType),
          discountValue: String(dto.discountValue),
          maximumDiscount:
            dto.maximumDiscount !== undefined
              ? String(dto.maximumDiscount)
              : null,
          weekdays: dto.weekdays?.length ? dto.weekdays : null,
          priority: dto.priority ?? 0,
          stackable: dto.stackable ?? false,
          exclusive: dto.exclusive ?? false,
          usageLimit: dto.usageLimit ?? null,
          startDate: dto.startDate,
          endDate: dto.endDate,
          isActive: dto.isActive ?? true,
        })
        .returning({ id: promotions.id });

      const id = Number(newPromo.id);

      if (dto.couponCode) {
        await tx.insert(coupons).values({
          promotionId: id,
          code: dto.couponCode.toUpperCase(),
          kind: 'discount',
          discountType:
            dto.discountType === DiscountType.FIJO ? 'fixed' : 'percentage',
          discountValue: String(dto.discountValue),
          maximumDiscount:
            dto.maximumDiscount !== undefined
              ? String(dto.maximumDiscount)
              : null,
          maxUsesTotal: dto.maxUsesTotal ?? null,
          maxUsesPerCustomer: dto.maxUsesPerCustomer ?? 1,
          startsAt: dto.startDate,
          expiresAt: dto.endDate,
          isActive: true,
        });
      }

      await this.replaceTargets(tx, id, dto);

      return id;
    });

    this.logger.log(`Promoción creada: ID=${promoId}, nombre="${dto.name}"`);
    return this.findOne(promoId);
  }

  async update(id: number, dto: UpdatePromotionDto) {
    const existing = await this.findOne(id);

    if (dto.startDate && dto.endDate) {
      if (new Date(dto.endDate) <= new Date(dto.startDate)) {
        throw new BadRequestException(
          'La fecha de fin debe ser posterior a la fecha de inicio',
        );
      }
    } else if (dto.startDate && !dto.endDate) {
      if (new Date(existing.endDate) <= new Date(dto.startDate)) {
        throw new BadRequestException(
          'La fecha de inicio debe ser anterior a la fecha de fin actual',
        );
      }
    } else if (!dto.startDate && dto.endDate) {
      if (new Date(dto.endDate) <= new Date(existing.startDate)) {
        throw new BadRequestException(
          'La fecha de fin debe ser posterior a la fecha de inicio actual',
        );
      }
    }

    const updateData: Record<string, unknown> = {};
    if (dto.name !== undefined) updateData.name = dto.name;
    if (dto.description !== undefined) updateData.description = dto.description;
    if (dto.isAutoApply !== undefined) updateData.isAutoApply = dto.isAutoApply;
    if (dto.priority !== undefined) updateData.priority = dto.priority;
    if (dto.stackable !== undefined) updateData.stackable = dto.stackable;
    if (dto.exclusive !== undefined) updateData.exclusive = dto.exclusive;
    if (dto.usageLimit !== undefined) updateData.usageLimit = dto.usageLimit;
    if (dto.startDate !== undefined) updateData.startDate = dto.startDate;
    if (dto.endDate !== undefined) updateData.endDate = dto.endDate;
    if (dto.isActive !== undefined) updateData.isActive = dto.isActive;
    if (dto.discountValue !== undefined)
      updateData.discountValue = String(dto.discountValue);
    if (dto.discountType !== undefined)
      updateData.discountType = this.dbDiscountType(dto.discountType);
    if (dto.maximumDiscount !== undefined)
      updateData.maximumDiscount = String(dto.maximumDiscount);
    if (dto.weekdays !== undefined)
      updateData.weekdays = dto.weekdays.length ? dto.weekdays : null;

    const dt = dto.discountType as string | undefined;
    if (dt === 'cupon' || dto.couponCode) {
      updateData.requiresCode = true;
    } else if (dt && dt !== 'cupon') {
      updateData.requiresCode = false;
    }

    if (Object.keys(updateData).length > 0) {
      await this.db
        .update(promotions)
        .set(updateData)
        .where(eq(promotions.id, BigInt(id)));
    }

    if (
      dto.categoryIds !== undefined ||
      dto.branchIds !== undefined ||
      dto.products !== undefined ||
      dto.combos !== undefined
    ) {
      await this.replaceTargets(this.db, id, dto);
    }

    // Update coupon
    if (dto.couponCode !== undefined) {
      if (dto.couponCode) {
        const existingCoupon = await this.db
          .select({ id: coupons.id })
          .from(coupons)
          .where(
            and(
              eq(coupons.code, dto.couponCode.toUpperCase()),
              sql`${coupons.promotionId} != ${id}`,
            ),
          )
          .limit(1);
        if (existingCoupon.length) {
          throw new BadRequestException(
            `El código de cupón "${dto.couponCode}" ya existe`,
          );
        }

        const currentCoupon = await this.db
          .select({ id: coupons.id })
          .from(coupons)
          .where(eq(coupons.promotionId, id))
          .limit(1);

        if (currentCoupon.length) {
          await this.db
            .update(coupons)
            .set({
              code: dto.couponCode.toUpperCase(),
              maxUsesTotal: dto.maxUsesTotal,
              maxUsesPerCustomer: dto.maxUsesPerCustomer,
              startsAt: dto.startDate ?? existing.startDate,
              expiresAt: dto.endDate ?? existing.endDate,
            })
            .where(eq(coupons.id, currentCoupon[0].id));
        } else {
          await this.db.insert(coupons).values({
            promotionId: id,
            code: dto.couponCode.toUpperCase(),
            maxUsesTotal: dto.maxUsesTotal ?? null,
            maxUsesPerCustomer: dto.maxUsesPerCustomer ?? 1,
            startsAt: dto.startDate ?? existing.startDate,
            expiresAt: dto.endDate ?? existing.endDate,
            isActive: true,
          });
        }
      }
    } else if (
      dto.maxUsesTotal !== undefined ||
      dto.maxUsesPerCustomer !== undefined
    ) {
      const couponUpdate: Record<string, unknown> = {};
      if (dto.maxUsesTotal !== undefined)
        couponUpdate.maxUsesTotal = dto.maxUsesTotal;
      if (dto.maxUsesPerCustomer !== undefined)
        couponUpdate.maxUsesPerCustomer = dto.maxUsesPerCustomer;
      await this.db
        .update(coupons)
        .set(couponUpdate)
        .where(eq(coupons.promotionId, id));
    }

    this.logger.log(`Promoción actualizada: ID=${id}`);
    return this.findOne(id);
  }

  async remove(id: number) {
    await this.findOne(id);

    await this.db
      .update(promotions)
      .set({
        deletedAt: new Date().toISOString(),
        isActive: false,
      })
      .where(eq(promotions.id, BigInt(id)));

    await this.db
      .update(coupons)
      .set({ isActive: false })
      .where(eq(coupons.promotionId, id));

    this.logger.log(`Promoción eliminada (soft): ID=${id}`);
    return { success: true, message: 'Promoción eliminada exitosamente' };
  }
}
