import { Injectable, Logger } from '@nestjs/common';
import { and, eq, gte, inArray, isNull, lte } from 'drizzle-orm';
import { DrizzleService } from '../../database/drizzle.service';
import {
  productCategories,
  productVariants,
  promotionBranches,
  promotionCategories,
  promotionComboItems,
  promotionCombos,
  promotionProducts,
  promotions,
} from '../../../drizzle/schema';

export type PromotionEngineItem = {
  productId: number;
  productVariantId: number;
  quantity: number;
  unitPrice: number;
};

export type PromotionEngineLine = PromotionEngineItem & {
  subtotal: number;
  discount: number;
  total: number;
};

export type PromotionEngineResult = {
  items: PromotionEngineLine[];
  subtotal: number;
  discountTotal: number;
  total: number;
  appliedPromotions: Array<{ id: number; name: string; amount: number }>;
};

const WEEKDAY_BY_LABEL: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/** Día de la semana en hora de Colombia (0=domingo … 6=sábado). */
export function weekdayInColombia(date: Date): number {
  const label = new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    timeZone: 'America/Bogota',
  }).format(date);
  return WEEKDAY_BY_LABEL[label] ?? date.getDay();
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Calcula el descuento en dinero de una línea.
 * - Porcentaje: sobre el subtotal de la línea.
 * - Monto fijo: por unidad × cantidad.
 */
function computeLineDiscount(
  item: { quantity: number; subtotal: number },
  value: number,
  isPercentage: boolean,
  maximumDiscount: number | null,
): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  let discount = isPercentage
    ? (item.subtotal * value) / 100
    : value * item.quantity;
  if (maximumDiscount != null && maximumDiscount > 0) {
    discount = Math.min(discount, maximumDiscount);
  }
  discount = Math.min(discount, item.subtotal);
  return Math.max(0, round2(discount));
}

type ProductRule = {
  discountValue: number | null;
  isPercentage: boolean;
  maximumDiscount: number | null;
};

type ComboRule = {
  quantityRequired: number;
  items: Array<{
    productId: number;
    discountValue: number;
    isPercentage: boolean;
  }>;
};

@Injectable()
export class PromotionEngineService {
  private readonly logger = new Logger(PromotionEngineService.name);

  constructor(private readonly drizzle: DrizzleService) {}

  private get db() {
    return this.drizzle.db;
  }

  /**
   * Evalúa las promociones vigentes para un carrito/pedido concreto.
   *
   * Reglas:
   * - Sólo promociones activas, sin código (las de cupón se validan aparte),
   *   dentro de su ventana de fechas y del día de la semana configurado.
   * - Si la promoción tiene sucursales, la sucursal del pedido debe estar.
   * - Si tiene categorías/productos/combos, sólo aplica a esos objetivos.
   * - Dentro de una promoción, el descuento del producto explícito manda sobre
   *   el descuento base de la categoría/catálogo; el combo manda sobre ambos.
   * - Los descuentos de varias promociones se acumulan sin superar el subtotal
   *   de la línea. Una promoción `exclusive` se aplica sola y descarta el resto.
   */
  async evaluate(
    items: PromotionEngineItem[],
    branchId: number | null,
    date: Date = new Date(),
  ): Promise<PromotionEngineResult> {
    const normalized = items
      .filter((item) => item.quantity > 0)
      .map((item) => ({
        ...item,
        subtotal: round2(item.unitPrice * item.quantity),
      }));

    const empty = (): PromotionEngineResult => ({
      items: normalized.map((item) => ({
        ...item,
        discount: 0,
        total: item.subtotal,
      })),
      subtotal: round2(normalized.reduce((sum, i) => sum + i.subtotal, 0)),
      discountTotal: 0,
      total: round2(normalized.reduce((sum, i) => sum + i.subtotal, 0)),
      appliedPromotions: [],
    });

    if (!normalized.length) return empty();

    const nowIso = date.toISOString();
    const promoRows = await this.db
      .select({
        id: promotions.id,
        name: promotions.name,
        discountType: promotions.discountType,
        discountValue: promotions.discountValue,
        maximumDiscount: promotions.maximumDiscount,
        weekdays: promotions.weekdays,
        priority: promotions.priority,
        exclusive: promotions.exclusive,
      })
      .from(promotions)
      .where(
        and(
          eq(promotions.isActive, true),
          isNull(promotions.deletedAt),
          eq(promotions.requiresCode, false),
          lte(promotions.startDate, nowIso),
          gte(promotions.endDate, nowIso),
        ),
      );

    const weekday = weekdayInColombia(date);
    const candidates = promoRows
      .filter((row) => !row.weekdays?.length || row.weekdays.includes(weekday))
      .sort(
        (a, b) =>
          (b.priority ?? 0) - (a.priority ?? 0) || Number(b.id) - Number(a.id),
      );

    if (!candidates.length) return empty();

    const promotionIds = candidates.map((row) => Number(row.id));

    const [catRows, branchRows, prodRows, comboRows, categoryRows] =
      await Promise.all([
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
            discountValue: promotionProducts.discountValue,
            isPercentage: promotionProducts.isPercentage,
            maximumDiscount: promotionProducts.maximumDiscount,
          })
          .from(promotionProducts)
          .innerJoin(
            productVariants,
            eq(productVariants.id, promotionProducts.productVariantId),
          )
          .where(inArray(promotionProducts.promotionId, promotionIds)),
        this.db
          .select({
            id: promotionCombos.id,
            promotionId: promotionCombos.promotionId,
            quantityRequired: promotionCombos.quantityRequired,
          })
          .from(promotionCombos)
          .where(inArray(promotionCombos.promotionId, promotionIds)),
        this.db
          .select({
            productId: productCategories.productId,
            categoryId: productCategories.categoryId,
          })
          .from(productCategories)
          .where(
            inArray(productCategories.productId, [
              ...new Set(normalized.map((item) => item.productId)),
            ]),
          ),
      ]);

    const comboIds = comboRows.map((row) => Number(row.id));
    const comboItemRows = comboIds.length
      ? await this.db
          .select({
            comboId: promotionComboItems.comboId,
            productId: productVariants.productId,
            discountValue: promotionComboItems.discountValue,
            isPercentage: promotionComboItems.isPercentage,
          })
          .from(promotionComboItems)
          .innerJoin(
            productVariants,
            eq(productVariants.id, promotionComboItems.productVariantId),
          )
          .where(inArray(promotionComboItems.comboId, comboIds))
      : [];

    const catByPromo = new Map<number, Set<number>>();
    for (const row of catRows) {
      const id = Number(row.promotionId);
      const set = catByPromo.get(id) ?? new Set<number>();
      set.add(Number(row.categoryId));
      catByPromo.set(id, set);
    }

    const branchesByPromo = new Map<number, Set<number>>();
    for (const row of branchRows) {
      const id = Number(row.promotionId);
      const set = branchesByPromo.get(id) ?? new Set<number>();
      set.add(Number(row.branchId));
      branchesByPromo.set(id, set);
    }

    const productsByPromo = new Map<number, Map<number, ProductRule>>();
    for (const row of prodRows) {
      const id = Number(row.promotionId);
      const map = productsByPromo.get(id) ?? new Map<number, ProductRule>();
      const productId = Number(row.productId);
      if (!map.has(productId)) {
        map.set(productId, {
          discountValue:
            row.discountValue != null ? Number(row.discountValue) : null,
          isPercentage: row.isPercentage,
          maximumDiscount:
            row.maximumDiscount != null ? Number(row.maximumDiscount) : null,
        });
      }
      productsByPromo.set(id, map);
    }

    const combosByPromo = new Map<number, ComboRule[]>();
    const comboById = new Map<number, ComboRule>();
    for (const row of comboRows) {
      const combo: ComboRule = {
        quantityRequired: row.quantityRequired,
        items: [],
      };
      comboById.set(Number(row.id), combo);
      const id = Number(row.promotionId);
      const list = combosByPromo.get(id) ?? [];
      list.push(combo);
      combosByPromo.set(id, list);
    }
    for (const row of comboItemRows) {
      const combo = comboById.get(Number(row.comboId));
      if (!combo) continue;
      combo.items.push({
        productId: Number(row.productId),
        discountValue: Number(row.discountValue),
        isPercentage: row.isPercentage,
      });
    }

    const categoriesByProduct = new Map<number, number[]>();
    for (const row of categoryRows) {
      const productId = Number(row.productId);
      const list = categoriesByProduct.get(productId) ?? [];
      list.push(Number(row.categoryId));
      categoriesByProduct.set(productId, list);
    }

    const quantityByProduct = new Map<number, number>();
    for (const item of normalized) {
      quantityByProduct.set(
        item.productId,
        (quantityByProduct.get(item.productId) ?? 0) + item.quantity,
      );
    }

    const lineDiscounts = normalized.map(() => 0);
    const appliedPromotions: PromotionEngineResult['appliedPromotions'] = [];
    let exclusiveApplied = false;

    for (const promo of candidates) {
      if (exclusiveApplied) break;

      const promotionId = Number(promo.id);

      const promoBranches = branchesByPromo.get(promotionId);
      if (promoBranches?.size) {
        if (branchId == null || !promoBranches.has(branchId)) continue;
      }

      const promoCategories = catByPromo.get(promotionId) ?? new Set<number>();
      const promoProducts =
        productsByPromo.get(promotionId) ?? new Map<number, ProductRule>();
      const promoCombos = combosByPromo.get(promotionId) ?? [];

      const hasTargets =
        promoCategories.size > 0 ||
        promoProducts.size > 0 ||
        promoCombos.length > 0;

      const baseValue = Number(promo.discountValue);
      const baseIsPercentage = promo.discountType !== 'fixed';
      const baseMaximum =
        promo.maximumDiscount != null ? Number(promo.maximumDiscount) : null;

      const contributions = normalized.map(() => 0);

      normalized.forEach((item, index) => {
        const rule = promoProducts.get(item.productId);
        let value: number | null = null;
        let isPercentage = baseIsPercentage;
        let maximum = baseMaximum;

        if (rule) {
          value = rule.discountValue ?? baseValue;
          isPercentage =
            rule.discountValue == null ? baseIsPercentage : rule.isPercentage;
          maximum = rule.maximumDiscount ?? baseMaximum;
        } else if (!hasTargets) {
          value = baseValue;
        } else if (
          promoCategories.size > 0 &&
          (categoriesByProduct.get(item.productId) ?? []).some((categoryId) =>
            promoCategories.has(categoryId),
          )
        ) {
          value = baseValue;
        }

        if (value == null) return;
        contributions[index] = computeLineDiscount(
          item,
          value,
          isPercentage,
          maximum,
        );
      });

      // Combos: sólo si el carrito tiene todos sus productos y la cantidad
      // mínima. El descuento del combo prevalece sobre el base/categoría.
      for (const combo of promoCombos) {
        if (!combo.items.length) continue;
        const comboProductIds = [
          ...new Set(combo.items.map((i) => i.productId)),
        ];
        if (
          !comboProductIds.every(
            (productId) => (quantityByProduct.get(productId) ?? 0) > 0,
          )
        ) {
          continue;
        }
        const totalQuantity = comboProductIds.reduce(
          (sum, productId) => sum + (quantityByProduct.get(productId) ?? 0),
          0,
        );
        if (totalQuantity < combo.quantityRequired) continue;

        for (const comboItem of combo.items) {
          const index = normalized.findIndex(
            (item) => item.productId === comboItem.productId,
          );
          if (index < 0) continue;
          const discount = computeLineDiscount(
            normalized[index],
            comboItem.discountValue,
            comboItem.isPercentage,
            null,
          );
          contributions[index] = Math.max(contributions[index], discount);
        }
      }

      let appliedAmount = 0;
      contributions.forEach((discount, index) => {
        if (discount <= 0) return;
        const remaining = normalized[index].subtotal - lineDiscounts[index];
        if (remaining <= 0) return;
        const add = Math.min(discount, remaining);
        lineDiscounts[index] += add;
        appliedAmount += add;
      });

      if (appliedAmount <= 0) continue;

      appliedPromotions.push({
        id: promotionId,
        name: promo.name,
        amount: round2(appliedAmount),
      });

      if (promo.exclusive) exclusiveApplied = true;
    }

    const resultItems = normalized.map((item, index) => ({
      ...item,
      discount: round2(lineDiscounts[index]),
      total: round2(item.subtotal - lineDiscounts[index]),
    }));

    const subtotal = round2(
      resultItems.reduce((sum, item) => sum + item.subtotal, 0),
    );
    const discountTotal = round2(
      resultItems.reduce((sum, item) => sum + item.discount, 0),
    );

    if (discountTotal > 0) {
      this.logger.debug(
        `Promociones aplicadas: ${appliedPromotions
          .map((p) => `${p.name} ($${p.amount})`)
          .join(', ')}`,
      );
    }

    return {
      items: resultItems,
      subtotal,
      discountTotal,
      total: round2(subtotal - discountTotal),
      appliedPromotions,
    };
  }
}
