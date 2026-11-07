import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { InventoryService } from './inventory.service';
import { createDbMock } from '../../../test/helpers/db-mock';

/**
 * Cadena encadenable como la de Drizzle, con `limit()`/`offset()` que siguen
 * devolviendo la cadena (el mock compartido resuelve `limit()` a una promesa y
 * no permite encadenar `.offset()` detrás, como hace `findAll`).
 */
function fluentSelect(rows: unknown[]) {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const chain: Record<string, any> = {};
  for (const method of [
    'from',
    'innerJoin',
    'leftJoin',
    'rightJoin',
    'where',
    'orderBy',
    'groupBy',
    'having',
    'limit',
    'offset',
  ]) {
    chain[method] = (...args: unknown[]) => {
      calls.push({ method, args });
      return chain;
    };
  }
  chain.then = (onFulfilled?: any, onRejected?: any) =>
    Promise.resolve(rows).then(onFulfilled, onRejected);
  chain.catch = (onRejected?: any) => Promise.resolve(rows).catch(onRejected);
  chain.finally = (onFinally?: any) => Promise.resolve(rows).finally(onFinally);
  return { chain, calls };
}

function inventoryRow(overrides: Record<string, any> = {}) {
  return {
    id: 10n,
    productId: 1,
    productName: 'Leche',
    variantId: 2,
    sku: 'LEC-1',
    barcode: null,
    price: 4500,
    branchId: 1,
    branchName: 'Centro',
    stock: 8,
    reservedStock: 2,
    reorderPoint: 5,
    minimumStock: 3,
    maximumStock: 50,
    targetStock: 20,
    lastMovementAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-02T00:00:00.000Z',
    ...overrides,
  };
}

describe('InventoryService', () => {
  let mock: ReturnType<typeof createDbMock>;
  let service: InventoryService;

  beforeEach(() => {
    mock = createDbMock();
    service = new InventoryService(mock.drizzle as any);
  });

  describe('findAll', () => {
    it('devuelve los ítems mapeados y el total', async () => {
      const { chain } = fluentSelect([inventoryRow()]);
      const { chain: countChain } = fluentSelect([{ total: 1 }]);
      mock.db.select
        .mockImplementationOnce(() => chain)
        .mockImplementationOnce(() => countChain);

      const result = await service.findAll({});

      expect(result.total).toBe(1);
      expect(result.items).toEqual([
        {
          id: 10,
          productId: 1,
          productName: 'Leche',
          variantId: 2,
          sku: 'LEC-1',
          barcode: null,
          price: 4500,
          branchId: 1,
          branchName: 'Centro',
          stock: 8,
          reservedStock: 2,
          reorderPoint: 5,
          minimumStock: 3,
          maximumStock: 50,
          targetStock: 20,
          lastMovementAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-02T00:00:00.000Z',
        },
      ]);
    });

    it('rellena los valores por defecto cuando faltan agregados', async () => {
      const { chain } = fluentSelect([
        inventoryRow({
          stock: null,
          reservedStock: null,
          reorderPoint: null,
          minimumStock: null,
          maximumStock: null,
          targetStock: null,
        }),
      ]);
      const { chain: countChain } = fluentSelect([{ total: 0 }]);
      mock.db.select
        .mockImplementationOnce(() => chain)
        .mockImplementationOnce(() => countChain);

      const result = await service.findAll({});

      expect(result.items[0]).toMatchObject({
        stock: 0,
        reservedStock: 0,
        reorderPoint: 0,
        minimumStock: 0,
        maximumStock: 999999,
        targetStock: null,
      });
    });

    it('aplica el límite y el desplazamiento por defecto', async () => {
      const { chain, calls } = fluentSelect([]);
      const { chain: countChain } = fluentSelect([{ total: 0 }]);
      mock.db.select
        .mockImplementationOnce(() => chain)
        .mockImplementationOnce(() => countChain);

      await service.findAll({});

      expect(calls.find((c) => c.method === 'limit')?.args).toEqual([100]);
      expect(calls.find((c) => c.method === 'offset')?.args).toEqual([0]);
    });

    it('respeta límite, desplazamiento y filtros explícitos', async () => {
      const { chain, calls } = fluentSelect([]);
      const { chain: countChain } = fluentSelect([{ total: 0 }]);
      mock.db.select
        .mockImplementationOnce(() => chain)
        .mockImplementationOnce(() => countChain);

      await service.findAll({
        branchId: 3,
        search: 'leche',
        stockFilter: 'low',
        limit: 25,
        offset: 50,
      });

      expect(calls.find((c) => c.method === 'limit')?.args).toEqual([25]);
      expect(calls.find((c) => c.method === 'offset')?.args).toEqual([50]);
      // Sucursal + búsqueda + stock bajo: 3 condiciones además de deletedAt.
      expect(calls.find((c) => c.method === 'where')).toBeDefined();
    });

    it('acepta los filtros de stock "out" y "normal" sin romperse', async () => {
      const { chain } = fluentSelect([]);
      const { chain: countChain } = fluentSelect([{ total: 0 }]);
      mock.db.select
        .mockImplementationOnce(() => chain)
        .mockImplementationOnce(() => countChain);

      await expect(service.findAll({ stockFilter: 'out' })).resolves.toEqual({
        items: [],
        total: 0,
      });

      const second = fluentSelect([]);
      const secondCount = fluentSelect([{ total: 0 }]);
      mock.db.select
        .mockImplementationOnce(() => second.chain)
        .mockImplementationOnce(() => secondCount.chain);

      await expect(service.findAll({ stockFilter: 'normal' })).resolves.toEqual(
        { items: [], total: 0 },
      );
    });
  });

  describe('getOne', () => {
    it('devuelve el inventario mapeado', async () => {
      mock.queueSelectOne(inventoryRow());

      await expect(service.getOne(10)).resolves.toMatchObject({
        id: 10,
        productName: 'Leche',
        stock: 8,
        maximumStock: 50,
      });
    });

    it('lanza 404 si no existe', async () => {
      mock.queueSelect([]);

      await expect(service.getOne(999)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(service.getOne(999)).rejects.toThrow(
        'Inventario 999 no encontrado',
      );
    });
  });

  describe('update', () => {
    it('actualiza solo los campos enviados y devuelve el registro', async () => {
      mock.queueSelectOne(inventoryRow({ stock: 12 }));
      mock.queueUpdate([]);

      const result = await service.update(10, { stock: 12 });

      expect(mock.state.updates).toHaveLength(1);
      expect(mock.state.updates[0].values).toMatchObject({ stock: 12 });
      expect(mock.state.updates[0].values.updatedAt).toEqual(
        expect.any(String),
      );
      expect(result.stock).toBe(12);
    });

    it('actualiza el punto de reorden y el stock objetivo', async () => {
      mock.queueSelectOne(inventoryRow());
      mock.queueUpdate([]);

      await service.update(10, { reorderPoint: 4, targetStock: 30 });

      expect(mock.state.updates[0].values).toMatchObject({
        reorderPoint: 4,
        targetStock: 30,
      });
    });

    it('no escribe si no hay campos que actualizar', async () => {
      mock.queueSelectOne(inventoryRow());

      await service.update(10, {});

      expect(mock.state.updates).toHaveLength(0);
    });
  });

  describe('getBranchStats', () => {
    it('mapea los agregados por sucursal', async () => {
      mock.queueSelect([
        {
          branchId: 1,
          branchName: 'Centro',
          totalProducts: 10,
          totalStock: '120',
          lowStockCount: 2,
        },
        {
          branchId: 2,
          branchName: 'Norte',
          totalProducts: 4,
          totalStock: '0',
          lowStockCount: 4,
        },
      ]);

      await expect(service.getBranchStats()).resolves.toEqual([
        {
          branchId: 1,
          branchName: 'Centro',
          totalProducts: 10,
          totalStock: '120',
          lowStockCount: 2,
        },
        {
          branchId: 2,
          branchName: 'Norte',
          totalProducts: 4,
          totalStock: '0',
          lowStockCount: 4,
        },
      ]);
    });

    it('devuelve una lista vacía si no hay sucursales con inventario', async () => {
      mock.queueSelect([]);

      await expect(service.getBranchStats()).resolves.toEqual([]);
    });
  });

  describe('getLowStock', () => {
    it('delega en findAll con el filtro de stock bajo y solo devuelve ítems', async () => {
      const { chain, calls } = fluentSelect([inventoryRow({ stock: 1 })]);
      const { chain: countChain } = fluentSelect([{ total: 1 }]);
      mock.db.select
        .mockImplementationOnce(() => chain)
        .mockImplementationOnce(() => countChain);

      const result = await service.getLowStock(10);

      expect(result).toHaveLength(1);
      expect(result[0].stock).toBe(1);
      expect(calls.find((c) => c.method === 'limit')?.args).toEqual([10]);
    });

    it('usa un límite de 50 por defecto', async () => {
      const { chain, calls } = fluentSelect([]);
      const { chain: countChain } = fluentSelect([{ total: 0 }]);
      mock.db.select
        .mockImplementationOnce(() => chain)
        .mockImplementationOnce(() => countChain);

      await service.getLowStock();

      expect(calls.find((c) => c.method === 'limit')?.args).toEqual([50]);
    });
  });
});
