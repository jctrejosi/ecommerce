import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CartService } from './cart.service';
import { createDbMock } from '../../../test/helpers/db-mock';

describe('CartService', () => {
  let mock: ReturnType<typeof createDbMock>;
  let engine: { evaluate: ReturnType<typeof vi.fn> };
  let service: CartService;

  beforeEach(() => {
    mock = createDbMock();
    engine = {
      evaluate: vi.fn(async (items: any[]) => ({
        items: items.map((item) => ({
          ...item,
          subtotal: item.unitPrice * item.quantity,
          discount: 0,
          total: item.unitPrice * item.quantity,
        })),
        subtotal: items.reduce(
          (sum, item) => sum + item.unitPrice * item.quantity,
          0,
        ),
        discountTotal: 0,
        total: items.reduce(
          (sum, item) => sum + item.unitPrice * item.quantity,
          0,
        ),
        appliedPromotions: [],
      })),
    };
    service = new CartService(mock.drizzle as any, engine as any);
  });

  it('cotiza un carrito vacío sin consultar la BD', async () => {
    const result = await service.quote([], null);

    expect(result).toEqual({
      items: [],
      subtotal: 0,
      discountTotal: 0,
      total: 0,
      appliedPromotions: [],
    });
    expect(mock.db.select).not.toHaveBeenCalled();
    expect(engine.evaluate).not.toHaveBeenCalled();
  });

  it('descarta ítems inválidos y usa la primera variante activa', async () => {
    mock.queueSelect([
      { variantId: 1n, productId: 10, price: '2500.00' },
      // Segunda variante del mismo producto: no debe reemplazar a la primera.
      { variantId: 2n, productId: 10, price: '999.00' },
      { variantId: 3n, productId: 20, price: '1000.00' },
    ]);

    const result = await service.quote(
      [
        { productId: 10, quantity: 2 },
        { productId: 99, quantity: 1 }, // sin variante: se omite
        { productId: 20, quantity: 1 },
      ],
      4,
    );

    expect(engine.evaluate).toHaveBeenCalledWith(
      [
        { productId: 10, productVariantId: 1, quantity: 2, unitPrice: 2500 },
        { productId: 20, productVariantId: 3, quantity: 1, unitPrice: 1000 },
      ],
      4,
    );
    expect(result.subtotal).toBe(6000);
    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toMatchObject({
      productId: 10,
      productVariantId: 1,
      unitPrice: 2500,
      quantity: 2,
      subtotal: 5000,
    });
  });

  it('pasa una lista vacía al motor si ningún producto tiene variante', async () => {
    mock.queueSelect([]);

    await service.quote([{ productId: 10, quantity: 1 }], null);

    expect(engine.evaluate).toHaveBeenCalledWith([], null);
  });
});
