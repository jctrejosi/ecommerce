import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CustomersService } from './customers.service';
import { createDbMock } from '../../../test/helpers/db-mock';
import type { DrizzleService } from '../../database/drizzle.service';

/**
 * `getAllCustomers` construye una subconsulta (`.as()`) y encadena
 * `limit().offset()`. El mock compartido no cubre esos dos detalles, así que
 * aquí se instala una cadena mínima equivalente para esa consulta.
 */
function installSelectQueue(
  select: ReturnType<typeof vi.fn>,
  batches: unknown[][],
) {
  const chains: any[] = [];
  select.mockImplementation(() => {
    let cached: unknown[] | undefined;
    const resolve = () => {
      cached ??= batches.shift() ?? [];
      return cached;
    };
    const chain: any = {
      from: vi.fn(() => chain),
      where: vi.fn(() => chain),
      leftJoin: vi.fn(() => chain),
      innerJoin: vi.fn(() => chain),
      groupBy: vi.fn(() => chain),
      orderBy: vi.fn(() => chain),
      as: vi.fn(() => ({ customerId: {}, total: {}, orderCount: {} })),
      limit: vi.fn(() => chain),
      offset: vi.fn(() => chain),
      then: (onFulfilled?: any, onRejected?: any) =>
        Promise.resolve().then(resolve).then(onFulfilled, onRejected),
      catch: (onRejected?: any) =>
        Promise.resolve().then(resolve).catch(onRejected),
      finally: (onFinally?: any) =>
        Promise.resolve().then(resolve).finally(onFinally),
    };
    chains.push(chain);
    return chain;
  });
  return chains;
}

function makeCustomerRow(overrides: Record<string, any> = {}) {
  return {
    id: 42n,
    email: 'cliente@test.local',
    firstName: 'Ada',
    lastName: 'Lovelace',
    phone: '3001234567',
    isActive: true,
    createdAt: '2024-01-01T00:00:00.000Z',
    lastLoginAt: null,
    totalSpent: '1500000',
    orderCount: 22,
    ...overrides,
  };
}

function makeCustomerEntity(overrides: Record<string, any> = {}) {
  return {
    id: 42n,
    email: 'cliente@test.local',
    firstName: 'Ada',
    lastName: 'Lovelace',
    phone: '3001234567',
    documentNumber: null,
    documentType: null,
    avatarUrl: null,
    provider: 'local',
    isVerified: true,
    isActive: true,
    acceptsMarketing: false,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-02T00:00:00.000Z',
    ...overrides,
  };
}

describe('CustomersService', () => {
  let mock: ReturnType<typeof createDbMock>;
  let service: CustomersService;

  beforeEach(() => {
    mock = createDbMock();
    service = new CustomersService(mock.drizzle as unknown as DrizzleService);
  });

  describe('getAllCustomers', () => {
    it('mapea clientes, lealtad y fecha del último pedido', async () => {
      const chains = installSelectQueue(mock.db.select as any, [
        [makeCustomerRow()],
        [{ customerId: 42, lastOrder: '2024-05-01T00:00:00.000Z' }],
      ]);

      const [customer] = await service.getAllCustomers();

      expect(customer).toEqual({
        id: 'C042',
        rawId: 42,
        name: 'Ada Lovelace',
        email: 'cliente@test.local',
        phone: '3001234567',
        orders: 22,
        spent: 1500000,
        loyalty: 'oro',
        joined: '2024-01-01',
        lastOrder: '2024-05-01',
        avatar: 'AL',
        isActive: true,
      });
      expect(chains[1].limit).toHaveBeenCalledWith(100);
      expect(chains[1].offset).toHaveBeenCalledWith(0);
    });

    it('devuelve una lista vacía sin consultar últimos pedidos', async () => {
      const chains = installSelectQueue(mock.db.select as any, [[]]);

      await expect(service.getAllCustomers()).resolves.toEqual([]);
      expect(chains).toHaveLength(2); // subconsulta + consulta principal
    });

    it('usa email como nombre y "?" como avatar cuando faltan datos', async () => {
      installSelectQueue(mock.db.select as any, [
        [
          makeCustomerRow({
            firstName: null,
            lastName: null,
            phone: null,
            totalSpent: null,
            orderCount: null,
            createdAt: null,
          }),
        ],
        [],
      ]);

      const [customer] = await service.getAllCustomers();

      expect(customer).toMatchObject({
        name: 'cliente@test.local',
        phone: '',
        spent: 0,
        orders: 0,
        loyalty: 'bronce',
        joined: '',
        lastOrder: '',
        avatar: '?',
      });
    });

    it('acota el límite entre 1 y 500 y normaliza el offset', async () => {
      let chains = installSelectQueue(mock.db.select as any, [[]]);
      await service.getAllCustomers({ limit: 5000, offset: -10 });
      expect(chains[1].limit).toHaveBeenCalledWith(500);
      expect(chains[1].offset).toHaveBeenCalledWith(0);

      chains = installSelectQueue(mock.db.select as any, [[]]);
      await service.getAllCustomers({ limit: 0 });
      expect(chains[1].limit).toHaveBeenCalledWith(1);
    });

    it('aplica el filtro de búsqueda', async () => {
      const chains = installSelectQueue(mock.db.select as any, [[]]);

      await service.getAllCustomers({ search: 'ada' });

      expect(chains[1].where).toHaveBeenCalledTimes(1);
    });

    it('asigna el nivel platino por número de pedidos', async () => {
      installSelectQueue(mock.db.select as any, [
        [makeCustomerRow({ totalSpent: '0', orderCount: 50 })],
        [],
      ]);

      const [customer] = await service.getAllCustomers();

      expect(customer.loyalty).toBe('platino');
    });
  });

  describe('getCustomerById', () => {
    it('devuelve el detalle con pedidos recientes', async () => {
      mock.queueSelect([
        {
          total: '1200000',
          orderCount: 12,
          lastOrder: '2024-06-01T00:00:00.000Z',
        },
      ]);
      mock.queueSelectOne(makeCustomerEntity());
      mock.queueSelect([
        {
          id: 'ORD-1',
          total: '50000',
          createdAt: '2024-06-01T00:00:00.000Z',
          itemCount: 0,
        },
      ]);

      const result = await service.getCustomerById(42);

      expect(result).toMatchObject({
        id: 'C042',
        name: 'Ada Lovelace',
        email: 'cliente@test.local',
        phone: '3001234567',
        loyalty: 'oro',
        orders: 12,
        spent: 1200000,
        joined: '2024-01-01',
        lastOrder: '2024-06-01',
        avatar: 'AL',
      });
      expect(result?.recentOrders).toEqual([
        { id: 'ORD-1', date: '2024-06-01', total: 50000 },
      ]);
    });

    it('devuelve null si el cliente no existe', async () => {
      mock.queueSelect([{ total: '0', orderCount: 0, lastOrder: null }]);
      mock.queueSelect([]);

      await expect(service.getCustomerById(99)).resolves.toBeNull();
    });

    it('calcula el nivel plata por gasto y bronce sin actividad', async () => {
      mock.queueSelect([
        {
          total: '350000',
          orderCount: 1,
          lastOrder: '2024-03-01T00:00:00.000Z',
        },
      ]);
      mock.queueSelectOne(makeCustomerEntity());
      mock.queueSelect([]);

      const result = await service.getCustomerById(42);

      expect(result?.loyalty).toBe('plata');
    });

    it('usa valores por defecto si el agregado viene vacío', async () => {
      mock.queueSelect([]);
      mock.queueSelectOne(makeCustomerEntity());
      mock.queueSelect([]);

      const result = await service.getCustomerById(42);

      expect(result).toMatchObject({ spent: 0, orders: 0, lastOrder: '' });
    });
  });

  describe('getLoyaltyStats', () => {
    it('cuenta clientes por nivel usando sus pedidos', async () => {
      mock.queueSelect([
        { customerId: 1, total: '2000000', orderCount: 1 }, // platino
        { customerId: 2, total: '400000', orderCount: 3 }, // plata
        { customerId: 3, total: '0', orderCount: 0 }, // bronce
      ]);
      mock.queueSelect([{ id: 1n }, { id: 2n }, { id: 4n }, { id: 5n }]);

      await expect(service.getLoyaltyStats()).resolves.toEqual({
        platino: 1,
        oro: 0,
        plata: 1,
        bronce: 2,
      });
    });

    it('ignora clientes sin pedidos del agregado', async () => {
      mock.queueSelect([{ customerId: null, total: '9999999', orderCount: 99 }]);
      mock.queueSelect([{ id: 1n }]);

      await expect(service.getLoyaltyStats()).resolves.toEqual({
        platino: 0,
        oro: 0,
        plata: 0,
        bronce: 1,
      });
    });
  });

  describe('getLoyaltyTiers', () => {
    it('devuelve la configuración de los cuatro niveles', async () => {
      const tiers = await service.getLoyaltyTiers();

      expect(tiers.map((tier) => tier.tier)).toEqual([
        'platino',
        'oro',
        'plata',
        'bronce',
      ]);
      expect(tiers[0]).toMatchObject({
        label: 'Platino',
        minSpent: 2000000,
        minOrders: 50,
      });
    });
  });
});
