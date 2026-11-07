import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  PromotionEngineService,
  weekdayInColombia,
} from './promotion-engine.service';
import { createDbMock } from '../../../test/helpers/db-mock';

function makePromo(overrides: Record<string, any> = {}) {
  return {
    id: 1n,
    name: 'Promo',
    discountType: 'percent',
    discountValue: '10.00',
    maximumDiscount: null,
    weekdays: null,
    priority: 0,
    exclusive: false,
    ...overrides,
  };
}

/** Simula los 5 selects en paralelo que hace el motor cuando hay candidatas. */
function queueTargets(
  mock: ReturnType<typeof createDbMock>,
  targets: {
    categories?: unknown[];
    branches?: unknown[];
    products?: unknown[];
    combos?: unknown[];
    productCategories?: unknown[];
    comboItems?: unknown[];
  } = {},
) {
  mock.queueSelect(targets.categories ?? []);
  mock.queueSelect(targets.branches ?? []);
  mock.queueSelect(targets.products ?? []);
  mock.queueSelect(targets.combos ?? []);
  mock.queueSelect(targets.productCategories ?? []);
  if ((targets.combos ?? []).length > 0) {
    mock.queueSelect(targets.comboItems ?? []);
  }
}

describe('PromotionEngineService', () => {
  let mock: ReturnType<typeof createDbMock>;
  let engine: PromotionEngineService;

  beforeEach(() => {
    mock = createDbMock();
    engine = new PromotionEngineService(mock.drizzle as any);
  });

  it('devuelve un resultado vacío sin consultar la BD si no hay ítems', async () => {
    const result = await engine.evaluate([], 1);

    expect(result).toEqual({
      items: [],
      subtotal: 0,
      discountTotal: 0,
      total: 0,
      appliedPromotions: [],
    });
    expect(mock.db.select).not.toHaveBeenCalled();
  });

  it('calcula subtotal y descuento porcentual de catálogo completo', async () => {
    mock.queueSelect([makePromo()]);
    queueTargets(mock);

    const result = await engine.evaluate(
      [
        { productId: 10, productVariantId: 100, quantity: 2, unitPrice: 25_000 },
        { productId: 20, productVariantId: 200, quantity: 1, unitPrice: 50_000 },
      ],
      1,
      new Date('2024-01-10T15:00:00Z'),
    );

    expect(result.subtotal).toBe(100_000);
    expect(result.discountTotal).toBe(10_000);
    expect(result.total).toBe(90_000);
    expect(result.items.map((item) => item.discount)).toEqual([5000, 5000]);
    expect(result.appliedPromotions).toEqual([
      { id: 1, name: 'Promo', amount: 10_000 },
    ]);
  });

  it('respeta el máximo de descuento configurado', async () => {
    mock.queueSelect([makePromo({ maximumDiscount: '3000.00' })]);
    queueTargets(mock);

    const result = await engine.evaluate(
      [{ productId: 10, productVariantId: 100, quantity: 2, unitPrice: 25_000 }],
      1,
      new Date('2024-01-10T15:00:00Z'),
    );

    expect(result.discountTotal).toBe(3000);
  });

  it('aplica un descuento fijo por unidad', async () => {
    mock.queueSelect([
      makePromo({ discountType: 'fixed', discountValue: '5000.00' }),
    ]);
    queueTargets(mock);

    const result = await engine.evaluate(
      [{ productId: 10, productVariantId: 100, quantity: 3, unitPrice: 10_000 }],
      1,
      new Date('2024-01-10T15:00:00Z'),
    );

    expect(result.discountTotal).toBe(15_000);
    expect(result.total).toBe(15_000);
  });

  it('excluye promociones fuera del día de la semana', async () => {
    // 2024-01-07 es domingo en Colombia; la promo solo aplica los lunes.
    mock.queueSelect([makePromo({ weekdays: [1] })]);

    const result = await engine.evaluate(
      [{ productId: 10, productVariantId: 100, quantity: 1, unitPrice: 10_000 }],
      1,
      new Date('2024-01-07T15:00:00Z'),
    );

    expect(weekdayInColombia(new Date('2024-01-07T15:00:00Z'))).toBe(0);
    expect(result.discountTotal).toBe(0);
  });

  it('aplica el descuento solo a los productos objetivo', async () => {
    mock.queueSelect([makePromo()]);
    queueTargets(mock, {
      products: [
        {
          promotionId: 1n,
          productId: 10,
          discountValue: '20.00',
          isPercentage: true,
          maximumDiscount: null,
        },
      ],
    });

    const result = await engine.evaluate(
      [
        { productId: 10, productVariantId: 100, quantity: 1, unitPrice: 10_000 },
        { productId: 20, productVariantId: 200, quantity: 1, unitPrice: 10_000 },
      ],
      1,
      new Date('2024-01-10T15:00:00Z'),
    );

    expect(result.items[0].discount).toBe(2000);
    expect(result.items[1].discount).toBe(0);
    expect(result.discountTotal).toBe(2000);
  });

  it('aplica el descuento base a categorías objetivo', async () => {
    mock.queueSelect([makePromo()]);
    queueTargets(mock, {
      categories: [{ promotionId: 1n, categoryId: 5n }],
      productCategories: [
        { productId: 10, categoryId: 5n },
        { productId: 20, categoryId: 6n },
      ],
    });

    const result = await engine.evaluate(
      [
        { productId: 10, productVariantId: 100, quantity: 1, unitPrice: 10_000 },
        { productId: 20, productVariantId: 200, quantity: 1, unitPrice: 10_000 },
      ],
      1,
      new Date('2024-01-10T15:00:00Z'),
    );

    expect(result.discountTotal).toBe(1000);
  });

  it('descarta promociones de otras sucursales', async () => {
    mock.queueSelect([makePromo()]);
    queueTargets(mock, {
      branches: [{ promotionId: 1n, branchId: 2n }],
    });

    const result = await engine.evaluate(
      [{ productId: 10, productVariantId: 100, quantity: 1, unitPrice: 10_000 }],
      1,
      new Date('2024-01-10T15:00:00Z'),
    );

    expect(result.discountTotal).toBe(0);
  });

  it('una promoción exclusiva descarta las demás', async () => {
    mock.queueSelect([
      makePromo({ id: 1n, priority: 10, exclusive: true }),
      makePromo({
        id: 2n,
        priority: 5,
        discountType: 'fixed',
        discountValue: '5000.00',
      }),
    ]);
    queueTargets(mock);
    // El bucle se corta tras la exclusiva: no se consumen más selects.

    const result = await engine.evaluate(
      [{ productId: 10, productVariantId: 100, quantity: 1, unitPrice: 10_000 }],
      1,
      new Date('2024-01-10T15:00:00Z'),
    );

    expect(result.discountTotal).toBe(1000);
    expect(result.appliedPromotions).toHaveLength(1);
  });

  it('el descuento de combo prevalece sobre el base', async () => {
    mock.queueSelect([makePromo({ discountValue: '5.00' })]);
    queueTargets(mock, {
      combos: [{ id: 9n, promotionId: 1n, quantityRequired: 2 }],
      comboItems: [
        {
          comboId: 9n,
          productId: 10,
          discountValue: '50.00',
          isPercentage: true,
        },
      ],
    });

    const result = await engine.evaluate(
      [{ productId: 10, productVariantId: 100, quantity: 2, unitPrice: 10_000 }],
      1,
      new Date('2024-01-10T15:00:00Z'),
    );

    // Combo: 50% de 20.000 = 10.000 (mayor que el 5% base).
    expect(result.discountTotal).toBe(10_000);
  });

  it('no aplica el combo si falta la cantidad mínima', async () => {
    mock.queueSelect([makePromo({ discountValue: '0' })]);
    queueTargets(mock, {
      combos: [{ id: 9n, promotionId: 1n, quantityRequired: 5 }],
      comboItems: [
        {
          comboId: 9n,
          productId: 10,
          discountValue: '50.00',
          isPercentage: true,
        },
      ],
    });

    const result = await engine.evaluate(
      [{ productId: 10, productVariantId: 100, quantity: 2, unitPrice: 10_000 }],
      1,
      new Date('2024-01-10T15:00:00Z'),
    );

    expect(result.discountTotal).toBe(0);
  });

  it('acumula descuentos sin superar el subtotal de la línea', async () => {
    mock.queueSelect([
      makePromo({ id: 1n, priority: 10, discountValue: '70.00' }),
      makePromo({ id: 2n, priority: 5, discountValue: '70.00' }),
    ]);
    queueTargets(mock);

    const result = await engine.evaluate(
      [{ productId: 10, productVariantId: 100, quantity: 1, unitPrice: 10_000 }],
      1,
      new Date('2024-01-10T15:00:00Z'),
    );

    expect(result.discountTotal).toBe(10_000);
    expect(result.total).toBe(0);
  });

  it('ignora ítems con cantidad cero o negativa', async () => {
    const result = await engine.evaluate(
      [{ productId: 10, productVariantId: 100, quantity: 0, unitPrice: 10_000 }],
      1,
    );

    expect(result.subtotal).toBe(0);
    expect(mock.db.select).not.toHaveBeenCalled();
  });
});
